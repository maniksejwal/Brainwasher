/**
 * @fileoverview AIsensy WhatsApp API Client
 * Sends messages via AIsensy's WhatsApp Business API
 */

import config from '../../config.js';

class AIsensyClient {
    constructor() {
        this.apiKey = process.env.AISENSY_API_KEY;
        this.apiUrl = process.env.AISENSY_API_URL || 'https://backend.aisensy.com/campaign/t1/api/v2';
        this.enabled = !!this.apiKey;
        
        if (!this.enabled) {
            console.log('[AIsensy] ℹ️  WhatsApp not configured (optional) - Set AISENSY_API_KEY in .env to enable');
        } else {
            console.log('[AIsensy] ✓ WhatsApp integration enabled');
        }
    }

    /**
     * Send message via WhatsApp
     */
    async sendMessage(phoneNumber, message) {
        if (!this.enabled) {
            // Silently skip - don't spam logs during development
            return { success: false, reason: 'not_configured', silent: true };
        }

        try {
            const response = await fetch(`${this.apiUrl}/send-message`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({
                    phone: phoneNumber,
                    message: message,
                    type: 'text'
                })
            });

            const result = await response.json();
            
            if (response.ok) {
                console.log(`[AIsensy] ✓ Sent to ${phoneNumber}`);
                return { success: true, messageId: result.messageId };
            } else {
                console.error(`[AIsensy] Error:`, result);
                return { success: false, error: result };
            }
        } catch (error) {
            console.error('[AIsensy] Send failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Send template message (for marketing/notifications)
     */
    async sendTemplate(phoneNumber, templateName, parameters) {
        if (!this.enabled) return { success: false };

        try {
            const response = await fetch(`${this.apiUrl}/send-template`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.apiKey
                },
                body: JSON.stringify({
                    phone: phoneNumber,
                    template: templateName,
                    parameters: parameters
                })
            });

            return await response.json();
        } catch (error) {
            console.error('[AIsensy] Template send failed:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Verify webhook signature (security)
     */
    verifyWebhookSignature(payload, signature) {
        // AIsensy-specific signature verification
        // Implement based on their docs
        return true; // Placeholder
    }
}

// Singleton
const aisensyClient = new AIsensyClient();

export default aisensyClient;
export { AIsensyClient };

