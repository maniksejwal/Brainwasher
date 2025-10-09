/**
 * @fileoverview WhatsApp Webhook Handler
 * Receives messages from AIsensy and routes to existing orchestrator
 * 
 * NON-BREAKING: Just adds new input channel, doesn't modify existing
 */

import { handleLogin, handleMessage, handleCommand } from '../../orchestrator.js';
import { getDb } from '../../db/connection.js';
import aisensyClient from './aisensyClient.js';

/**
 * Handle incoming WhatsApp webhook (Safe: validates before processing)
 */
async function handleWhatsAppWebhook(req, res) {
    try {
        // Validate payload
        if (!req.body || !req.body.phone || !req.body.message) {
            console.log('[WhatsApp] Invalid webhook payload');
            return res.status(400).json({ error: 'Invalid payload' });
        }

        const { phone, message, type, timestamp } = req.body;
        
        console.log(`[WhatsApp] Incoming from ${phone}: ${message}`);

        // Map phone number to userId
        const userId = await getOrCreateUserFromPhone(phone);
        
        // Get user's active circle
        const circleId = await getUserActiveCircle(userId);

        // Route to existing system (REUSE existing handlers!)
        if (message.startsWith('/')) {
            // Command
            await handleCommand(userId, circleId, message);
        } else {
            // Regular message
            await handleMessage(userId, circleId, message);
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('[WhatsApp] Webhook error:', error);
        res.status(500).json({ error: error.message });
    }
}

/**
 * Get or create user from phone number
 */
async function getOrCreateUserFromPhone(phoneNumber) {
    const db = await getDb();
    
    // Check if phone number is mapped
    const mapping = await db.get(
        'SELECT user_id FROM whatsapp_users WHERE phone_number = ?',
        [phoneNumber]
    );

    if (mapping) {
        return mapping.user_id;
    }

    // New WhatsApp user - create account
    const username = `wa_${phoneNumber.slice(-4)}`; // Generate username from phone
    
    // Use existing login handler (REUSE!)
    const loginResult = await handleLogin(username);
    
    // Map phone to userId
    await db.run(
        'INSERT INTO whatsapp_users (phone_number, user_id) VALUES (?, ?)',
        [phoneNumber, loginResult.userId]
    );

    console.log(`[WhatsApp] New user created: ${phoneNumber} → ${username}`);
    
    return loginResult.userId;
}

/**
 * Get user's active care circle
 */
async function getUserActiveCircle(userId) {
    const db = await getDb();
    
    // Check if user has stored active circle
    const active = await db.get(
        'SELECT active_circle_id FROM whatsapp_sessions WHERE user_id = ?',
        [userId]
    );

    if (active?.active_circle_id) {
        return active.active_circle_id;
    }

    // Default to personal circle
    return userId;
}

/**
 * Send message to WhatsApp user (Safe: won't crash if WhatsApp not configured)
 */
async function sendToWhatsApp(userId, message) {
    try {
        // Skip if AIsensy not configured (development mode)
        if (!aisensyClient.enabled) {
            return { success: false, reason: 'whatsapp_not_configured' };
        }

        const db = await getDb();
        
        // Get phone number for user
        const mapping = await db.get(
            'SELECT phone_number FROM whatsapp_users WHERE user_id = ?',
            [userId]
        );

        if (!mapping) {
            // User is CLI-only, not a WhatsApp user - this is fine
            return { success: false, reason: 'not_whatsapp_user' };
        }

        // Send via AIsensy
        const result = await aisensyClient.sendMessage(mapping.phone_number, message);
        return result;
    } catch (error) {
        // Fail silently - don't crash if WhatsApp has issues
        console.error('[WhatsApp] Error (non-critical):', error.message);
        return { success: false, error: error.message };
    }
}

export { handleWhatsAppWebhook, sendToWhatsApp };
