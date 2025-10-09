/**
 * @fileoverview Ephemeral session manager for privacy-preserving negotiations
 * Sessions and agent data are destroyed after conclusion
 */

import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

const SESSIONS_DIR = './sessions/negotiations';
const SESSION_EXPIRY_MS = 86400000; // 24 hours

class EphemeralSessionManager {
    constructor() {
        this.activeSessions = new Map();
        this._startCleanupTimer();
    }

    /**
     * Create a new negotiation session
     */
    async createSession(participants, topic, type = 'negotiation', metadata = {}) {
        const sessionId = randomUUID();
        
        const session = {
            id: sessionId,
            type,
            participants,
            topic,
            metadata,
            messages: [],
            agentStates: {},
            created: Date.now(),
            expires: Date.now() + SESSION_EXPIRY_MS,
            status: 'active'
        };

        // Initialize agent states for each participant
        for (const userId of participants) {
            session.agentStates[userId] = {
                userId,
                internalState: {},
                strategy: null,
                movesCalculated: []
            };
        }

        this.activeSessions.set(sessionId, session);
        await this._persistSession(sessionId, session);

        console.log(`[SessionManager] Created ephemeral session: ${sessionId}`);
        return session;
    }

    /**
     * Add message to session
     */
    async addMessage(sessionId, fromUserId, messageType, content, terms = null) {
        const session = await this.getSession(sessionId);
        if (!session) {
            throw new Error(`Session ${sessionId} not found`);
        }

        const message = {
            id: randomUUID(),
            from: fromUserId,
            type: messageType,
            content,
            terms,
            timestamp: Date.now(),
            ephemeral: true // Will be deleted
        };

        session.messages.push(message);
        await this._persistSession(sessionId, session);

        return message;
    }

    /**
     * Update agent internal state
     */
    async updateAgentState(sessionId, userId, state) {
        const session = await this.getSession(sessionId);
        if (!session) return;

        session.agentStates[userId] = {
            ...session.agentStates[userId],
            ...state,
            lastUpdated: Date.now()
        };

        await this._persistSession(sessionId, session);
    }

    /**
     * Conclude session and extract agreement
     */
    async concludeSession(sessionId, outcome, finalTerms) {
        const session = await this.getSession(sessionId);
        if (!session) return null;

        session.status = 'concluded';
        session.concluded = Date.now();

        // Extract ONLY the final agreement
        const agreement = {
            sessionId,
            participants: session.participants,
            topic: session.topic,
            outcome, // 'success', 'failure', 'terminated'
            finalTerms, // Only if successful
            timestamp: Date.now(),
            duration: session.concluded - session.created
        };

        console.log(`[SessionManager] Concluding session ${sessionId}: ${outcome}`);
        
        // Destroy ephemeral data
        await this.destroySessionData(sessionId);

        return agreement;
    }

    /**
     * DESTROY session data (privacy feature)
     */
    async destroySessionData(sessionId) {
        const session = this.activeSessions.get(sessionId);
        if (!session) return;

        console.log(`[Privacy] Destroying ephemeral data for session ${sessionId}...`);
        
        // Delete messages
        const messageCount = session.messages.length;
        session.messages = [];
        
        // Delete agent internal states (strategies, reasoning)
        const agentCount = Object.keys(session.agentStates).length;
        for (const userId in session.agentStates) {
            session.agentStates[userId].internalState = null;
            session.agentStates[userId].strategy = null;
            session.agentStates[userId].movesCalculated = null;
        }

        // Remove from memory
        this.activeSessions.delete(sessionId);

        // Delete file
        const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
        try {
            await fs.unlink(sessionPath);
        } catch (error) {
            // Already deleted or doesn't exist
        }

        console.log(`[Privacy] ✓ Destroyed: ${messageCount} messages, ${agentCount} agent states`);
        console.log(`[Privacy] ✓ Session ${sessionId} fully erased`);
    }

    /**
     * Get active session
     */
    async getSession(sessionId) {
        // Check memory cache first
        if (this.activeSessions.has(sessionId)) {
            return this.activeSessions.get(sessionId);
        }

        // Load from disk
        try {
            const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
            const data = await fs.readFile(sessionPath, 'utf8');
            const session = JSON.parse(data);
            this.activeSessions.set(sessionId, session);
            return session;
        } catch (error) {
            return null;
        }
    }

    /**
     * Get user's active sessions
     */
    async getUserSessions(userId) {
        const sessions = [];
        for (const [id, session] of this.activeSessions) {
            if (session.participants.includes(userId) && session.status === 'active') {
                sessions.push(session);
            }
        }
        return sessions;
    }

    /**
     * Persist session to disk
     */
    async _persistSession(sessionId, session) {
        try {
            await fs.mkdir(SESSIONS_DIR, { recursive: true });
            const sessionPath = path.join(SESSIONS_DIR, `${sessionId}.json`);
            await fs.writeFile(sessionPath, JSON.stringify(session, null, 2), 'utf8');
        } catch (error) {
            console.error(`[SessionManager] Error persisting session:`, error.message);
        }
    }

    /**
     * Auto-cleanup expired sessions
     */
    async cleanupExpiredSessions() {
        const now = Date.now();
        let cleaned = 0;

        for (const [sessionId, session] of this.activeSessions) {
            if (session.expires < now) {
                console.log(`[SessionManager] Auto-cleanup expired session: ${sessionId}`);
                await this.concludeSession(sessionId, 'expired', null);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            console.log(`[SessionManager] Cleaned up ${cleaned} expired sessions`);
        }
    }

    /**
     * Start automatic cleanup timer
     */
    _startCleanupTimer() {
        setInterval(() => {
            this.cleanupExpiredSessions();
        }, 3600000); // Every hour
    }

    /**
     * Emergency destroy all sessions (for testing/debugging)
     */
    async destroyAllSessions() {
        console.log('[SessionManager] DESTROYING ALL SESSIONS...');
        
        const sessionIds = Array.from(this.activeSessions.keys());
        for (const sessionId of sessionIds) {
            await this.destroySessionData(sessionId);
        }

        console.log(`[SessionManager] ✓ Destroyed ${sessionIds.length} sessions`);
    }
}

// Singleton
const sessionManager = new EphemeralSessionManager();

export default sessionManager;
export { EphemeralSessionManager };

