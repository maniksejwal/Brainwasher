/**
 * @fileoverview services/conversationNotices.js
 * Tells HealthyMitra the moment a user's conversation changes: an agent message was saved,
 * or a job finished. HealthyMitra then updates the open chat and the chat list at once
 * instead of waiting for its next history read.
 *
 * A notice is only a hint. A failed one is logged, and HealthyMitra still sees the change in
 * the history it reads. It carries a short preview of the message, never the whole text.
 */
import { postToHealthyMitra } from '../lib/healthyMitraClient.js';
import { findExternalIdentityByUser } from '../db/index.js';

export const CONVERSATION_NOTICE_PATH = '/api/integrations/healthymitra-ai/conversation-events';
export const CONVERSATION_NOTICE_PURPOSE = 'conversation.updated';
export const PREVIEW_MAX_LENGTH = 120;
const PROVIDER = 'healthymitra';

/**
 * Send a conversation notice. Returns at once; the request runs in the background.
 * @param {object} params
 * @param {string} params.userId - Local user who owns the conversation
 * @param {string} params.conversationId
 * @param {{messageId: string, text: string, createdAt: number}|null} [params.message] - The
 *   agent message just saved, or null when only the job state changed
 * @returns {Promise<void>} Settles when the notice was sent or given up (tests)
 */
export function notifyConversationUpdated({ userId, conversationId, message = null }) {
    // HealthyMitra is optional; without its address there is no one to tell
    if (!process.env.HEALTHYMITRA_BASE_URL) return Promise.resolve();
    return (async () => {
        const externalUserId = (await findExternalIdentityByUser(PROVIDER, userId))?.external_user_id;
        if (!externalUserId) return;
        const { status } = await postToHealthyMitra({
            path: CONVERSATION_NOTICE_PATH,
            userId: externalUserId,
            purpose: CONVERSATION_NOTICE_PURPOSE,
            body: {
                conversationId,
                message: message && {
                    messageId: message.messageId,
                    sender: 'agent',
                    preview: message.text.replace(/\s+/g, ' ').trim().slice(0, PREVIEW_MAX_LENGTH),
                    createdAt: new Date(message.createdAt).toISOString()
                }
            }
        });
        if (status >= 300) console.warn(`[ConversationNotices] HealthyMitra answered ${status} to a notice for ${conversationId}`);
    })().catch(error => console.warn(`[ConversationNotices] Could not notify HealthyMitra about ${conversationId}:`, error.message));
}
