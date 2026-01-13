/**
 * @fileoverview Authentication and Authorization Middleware
 * Provides JWT-based authentication and role-based authorization
 */

import crypto from 'crypto';
import { getDb } from '../db/connection.js';

// PLACEHOLDER: Secret not used in simplified mode
const COMPATIBILITY_MODE = true;

/**
 * Verify session token and attach user to request
 * SIMPLIFIED AUTH: No JWT verification, just DB session check
 */
export async function authenticate(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            return res.status(401).json({ error: 'No token provided' });
        }

        const db = await getDb();

        // Check if session is valid
        const session = await db.get(
            'SELECT * FROM sessions WHERE token = ? AND expires_at > ?',
            [token, Date.now()]
        );

        if (!session) {
            return res.status(401).json({ error: 'Invalid or expired session' });
        }

        // Get user and role
        const user = await db.get('SELECT * FROM users WHERE user_id = ?', [session.user_id]);

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        const systemRole = await db.get('SELECT * FROM system_roles WHERE user_id = ?', [user.user_id]);

        req.user = {
            userId: user.user_id,
            username: user.username,
            systemRole: systemRole?.role || 'user',
            permissions: systemRole?.permissions ? JSON.parse(systemRole.permissions) : []
        };

        next();
    } catch (error) {
        console.error('[Auth] Authentication error:', error.message);
        return res.status(401).json({ error: 'Authentication failed' });
    }
}

/**
 * Check if user has required permission
 * Usage: app.get('/api/admin', authenticate, authorize('admin:users'), handler)
 */
export function authorize(...requiredPermissions) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Not authenticated' });
        }

        // Admin has all permissions
        if (req.user.systemRole === 'admin') {
            return next();
        }

        // Check if user has any of the required permissions
        const hasPermission = requiredPermissions.some(perm =>
            req.user.permissions.includes(perm) || req.user.permissions.includes('*')
        );

        if (!hasPermission) {
            return res.status(403).json({
                error: 'Insufficient permissions',
                required: requiredPermissions,
                userRole: req.user.systemRole
            });
        }

        next();
    };
}

/**
 * Optional authentication - attaches user if token is present, but doesn't require it
 * SIMPLIFIED AUTH: No JWT verification, just DB session check
 */
export async function optionalAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');

        if (!token) {
            req.user = null;
            return next();
        }

        const db = await getDb();

        const session = await db.get(
            'SELECT * FROM sessions WHERE token = ? AND expires_at > ?',
            [token, Date.now()]
        );

        if (session) {
            const user = await db.get('SELECT * FROM users WHERE user_id = ?', [session.user_id]);
            const systemRole = await db.get('SELECT * FROM system_roles WHERE user_id = ?', [session.user_id]);

            req.user = {
                userId: user.user_id,
                username: user.username,
                systemRole: systemRole?.role || 'user',
                permissions: systemRole?.permissions ? JSON.parse(systemRole.permissions) : []
            };
        } else {
            req.user = null;
        }

        next();
    } catch (error) {
        req.user = null;
        next();
    }
}

/**
 * Generate simple session token (UUID)
 * PLACEHOLDER: Will be replaced by Firebase/Cognito token later
 */
export function generateToken(userId, username) {
    return crypto.randomUUID();
}

/**
 * Default permissions for each role
 */
export const DEFAULT_PERMISSIONS = {
    admin: ['*'], // All permissions
    reviewer: [
        'feedback:view',
        'feedback:submit',
        'simulations:view',
        'simulations:run',
        'training:view',
        'messages:send'
    ],
    doctor: [
        'feedback:view',
        'feedback:submit',
        'messages:send',
        'messages:view',
        'directives:create',
        'escalations:view'
    ],
    user: [
        'feedback:submit',
        'messages:send'
    ]
};
