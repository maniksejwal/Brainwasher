/**
 * @fileoverview state_manager.js
 * This module manages the short-term conversational state for each user,
 * particularly for handling multi-step interactions like a stack of pending questions.
 * It ensures the AI can understand which question a user is replying to, making
 * conversations more robust and less prone to context loss.
 */

import {
    addPendingAction,
    removePendingAction,
    getActivePendingActions,
    addMessage,
    findUserById
} from './db/index.js';
import { randomUUID } from 'crypto';
import { classifyUserIntent, matchResponseToAction } from './agents/index.js';

/**
 * Creates a new pending action and adds it to the user's question stack.
 * @param {string} userId - The ID of the user to create the action for.
 * @param {string} circleId - The ID of the care circle for context.
 * @param {object} suggestion - The AI's suggestion object.
 * @param {string} actionType - The type of action being created.
 * @returns {string} The ID of the newly created action.
 */
export async function createSharingConsentAction(userId, circleId, suggestion, actionType = 'share_consent') {
    const actionId = randomUUID();
    await addPendingAction(actionId, circleId, userId, actionType, suggestion);
    return actionId;
}

/**
 * Handles a user's response by checking it against a stack of pending actions.
 * @param {string} userId - The ID of the user responding.
 * @param {string} circleId - The ID of the current care circle.
 * @param {string} message - The user's message text.
 * @returns {object|null} An object with the action result, or null if no action was handled.
 */
export async function handleUserResponseToAction(userId, circleId, message) {
    const pendingActions = await getActivePendingActions(userId, circleId);

    if (pendingActions.length === 0) {
        return null;
    }

    const matchResult = await matchResponseToAction(message, pendingActions);

    if (!matchResult || !matchResult.matched_action_id) {
        return null;
    }

    const matchedAction = pendingActions.find(a => a.action_id === matchResult.matched_action_id);
    if (!matchedAction) {
        return null;
    }

    let intent = { intent: 'UNCLEAR' };
    const lowerCaseMessage = message.toLowerCase().trim();
    if (['/yes', 'yes', 'go', 'proceed'].includes(lowerCaseMessage)) {
        intent.intent = 'CONSENT_GRANTED';
    } else if (['/no', 'no'].includes(lowerCaseMessage)) {
        intent.intent = 'CONSENT_DENIED';
    } else {
        intent = await classifyUserIntent(message, matchedAction.details.reason);
    }


    if (intent.intent === 'UNCLEAR') {
        return null;
    }

    await removePendingAction(matchedAction.action_id);

    if (intent.intent === 'CONSENT_GRANTED') {
        if (matchedAction.action_type === 'implied_switch_consent') {
            return {
                action: 'execute',
                details: { ...matchedAction, ...matchedAction.details }, // Spread details into top level
                reply: `[Personal Note] Thank you. I've logged that note.`
            };
        } else { // Default 'share_consent'
            return {
                action: 'execute',
                details: { ...matchedAction, ...matchedAction.details },
                reply: "[Personal Note] Thank you. I've acted on your request."
            };
        }
    } else { // CONSENT_DENIED
        return {
            action: 'cancel',
            reply: "[Personal Note] Understood. I will not share it."
        };
    }
}

