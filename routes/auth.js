import express from 'express';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { handleLogin } from '../handlers/loginHandler.js';
import { authenticate, generateToken, DEFAULT_PERMISSIONS } from '../middleware/auth.js';

const router = express.Router();

// Public: Login
router.post('/login', async (req, res) => {
    try {
        const { username, role = 'user', password } = req.body;

        // Log placeholder password usage (Simulated Auth)
        if (password) {
            console.log(`[Auth] Password provided for ${username} but ignored (Simulated Auth Mode)`);
        }

        if (!username) {
            return res.status(400).json({ error: 'Username required' });
        }

        // 1. Use existing handler to Get/Create User and Care Circle Context
        const loginResult = await handleLogin(username);
        const { userId } = loginResult;

        const db = await getDb();

        // 2. RBAC Logic: Assign/Update Role
        let systemRole = await db.get('SELECT * FROM system_roles WHERE user_id = ?', [userId]);

        if (!systemRole) {
            const permissions = JSON.stringify(DEFAULT_PERMISSIONS[role] || []);
            await db.run('INSERT INTO system_roles (user_id, role, permissions, created_at) VALUES (?, ?, ?, ?)',
                [userId, role, permissions, Date.now()]);
            systemRole = { role, permissions };
            console.log(`[Auth] Assigned role ${role} to ${username}`);
        } else if (role && role !== systemRole.role) {
            // Allow role switching in prototype mode
            const permissions = JSON.stringify(DEFAULT_PERMISSIONS[role] || []);
            await db.run('UPDATE system_roles SET role = ?, permissions = ? WHERE user_id = ?',
                [role, permissions, userId]);
            systemRole = { role, permissions };
            console.log(`[Auth] Updated role for ${username} to ${role}`);
        }

        // 3. Create Session
        const token = generateToken(userId, username);
        const expiresAt = Date.now() + (7 * 24 * 60 * 60 * 1000); // 7 days
        const sessionId = crypto.randomUUID();

        await db.run('INSERT INTO sessions (session_id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
            [sessionId, userId, token, expiresAt, Date.now()]);

        // 4. Return Merged Response
        res.json({
            ...loginResult, // functionality from handleLogin (activeCircleId, etc.)
            token,
            user: {
                id: userId,
                username: username,
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
