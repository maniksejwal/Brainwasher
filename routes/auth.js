import express from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/index.js';
import { handleLogin } from '../handlers/loginHandler.js';
import { authenticate, generateToken, DEFAULT_PERMISSIONS } from '../middleware/auth.js';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import config from '../config.js';

const router = express.Router();

/** When REQUIRE_COGNITO_LOGIN=true, username-only login is rejected in production if Cognito is configured (except localhost). */
function allowsLegacyUsernameLogin(req) {
    if (process.env.REQUIRE_COGNITO_LOGIN !== 'true') {
        return true;
    }
    if (!verifier) {
        return true;
    }
    const host = (req.get('host') || '').split(':')[0].toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return true;
    }
    return false;
}

let verifier;

// Initialize verification only if Cognito config is present
const setupVerifier = () => {
    if (config.COGNITO_USER_POOL_ID && config.COGNITO_CLIENT_ID) {
        verifier = CognitoJwtVerifier.create({
            userPoolId: config.COGNITO_USER_POOL_ID,
            tokenUse: "id",
            clientId: config.COGNITO_CLIENT_ID,
        });
        console.log('[Auth] Cognito verifier initialized');
    } else {
        console.warn('[Auth] Cognito config missing. Falling back to Legacy/Simulated Auth.');
    }
};

setupVerifier();

// Verify Cognito Token helper
async function verifyCognitoToken(token) {
    if (!verifier) return null; // Fallback
    try {
        const payload = await verifier.verify(token);
        return payload;
    } catch (err) {
        console.error('[Auth] Token verification failed:', err.message);
        throw new Error('Invalid Token');
    }
}

// Public: Login / Exchange Token
router.post('/login', async (req, res) => {
    try {
        const { username, role = 'user', password, token } = req.body;
        let finalUsername = username;
        let isCognitoAuth = false;

        // 1. Validate Token (Cognito Mode)
        if (token && verifier) {
            const payload = await verifyCognitoToken(token);
            if (payload) {
                finalUsername = payload['email'] || payload['cognito:username'] || username;
                isCognitoAuth = true;
                console.log(`[Auth] Authenticated via Cognito: ${finalUsername}`);
            }
        }

        // 2. Legacy/Fallback Validation
        if (!isCognitoAuth) {
            if (!allowsLegacyUsernameLogin(req)) {
                return res.status(401).json({
                    error: 'Cognito login required',
                    hint: 'Set REQUIRE_COGNITO_LOGIN=false for migration, or send a valid Cognito id token in body.token'
                });
            }
            if (!username) {
                return res.status(400).json({ error: 'Username required' });
            }
            // Logic for "simulated" password check would go here if we weren't replacing it
            if (password) {
                console.log(`[Auth] Password provided for ${username} but ignored (Simulated Auth Mode)`);
            }
        }

        // 3. User & Context Setup (Common Path)
        // Use existing handler to Get/Create User and Care Circle Context
        const loginResult = await handleLogin(finalUsername);
        const { userId } = loginResult;

        const db = await getDb();

        // 4. RBAC Logic: Assign/Update Role
        let systemRole = await db.get('SELECT * FROM system_roles WHERE user_id = ?', [userId]);

        if (!systemRole) {
            const permissions = JSON.stringify(DEFAULT_PERMISSIONS[role] || []);
            await db.run('INSERT INTO system_roles (user_id, role, permissions, created_at) VALUES (?, ?, ?, ?)',
                [userId, role, permissions, Date.now()]);
            systemRole = { role, permissions };
            console.log(`[Auth] Assigned role ${role} to ${finalUsername}`);
        } else if (role && role !== systemRole.role) {
            // Allow role switching
            const permissions = JSON.stringify(DEFAULT_PERMISSIONS[role] || []);
            await db.run('UPDATE system_roles SET role = ?, permissions = ? WHERE user_id = ?',
                [role, permissions, userId]);
            systemRole = { role, permissions };
            console.log(`[Auth] Updated role for ${finalUsername} to ${role}`);
        }

        // 5. Create Session (Internal Session)
        // Even with Cognito, we create an internal session for our specialized middleware
        const sessionToken = generateToken(userId, finalUsername);
        const sessionExpiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        const sessionId = randomUUID();

        await db.run('INSERT INTO sessions (session_id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            [sessionId, userId, sessionToken, sessionExpiresAt, Date.now()]);

        // 6. Return Merged Response
        res.json({
            ...loginResult,
            token: sessionToken, // Internal token for subsequent API calls
            user: {
                id: userId,
                username: finalUsername,
                role: systemRole.role,
                permissions: JSON.parse(systemRole.permissions || '[]')
            }
        });
    } catch (err) {
        console.error('[Auth] Login error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Authenticated: Logout
router.post('/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            const db = await getDb();
            await db.run('DELETE FROM sessions WHERE token = ?', [token]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('[Auth] Logout error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Authenticated: Get Current User
router.get('/me', authenticate, (req, res) => {
    res.json({
        user: {
            id: req.user.userId,
            username: req.user.username,
            role: req.user.systemRole,
            permissions: req.user.permissions
        }
    });
});

export default router;
