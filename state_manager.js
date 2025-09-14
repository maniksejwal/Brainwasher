/**
 * @fileoverview This module manages the short-term conversational state for each user,
 * particularly for handling multi-step interactions like a stack of pending questions.
 */

import {
    addPendingAction,
    removePendingAction,
    updateUserState,
    getActivePendingActions // Use the new function to get the whole stack
} from './db/index.js';
import { randomUUID } from 'crypto';
import { classifyUserIntent, matchResponseToAction } from './agents/index.js';

/**
 * Creates a new pending action and adds it to the user's stack.
 */
export async function createSharingConsentAction(userId, circleId, sharingSuggestion) {
    const actionId = randomUUID();
    await addPendingAction(actionId, circleId, userId, 'share_consent', sharingSuggestion);
    // We no longer need to manage a single state in the user table, the presence
    // of items in the pending_actions table IS the state.
    return actionId;
}

/**
 * Handles a user's response by checking it against a stack of pending actions.
 */
export async function handleUserResponseToAction(userId, circleId, message) {
    const pendingActions = await getActivePendingActions(userId, circleId);

    // If there are no pending actions, there's nothing to do.
    if (pendingActions.length === 0) {
        return null;
    }

    // Use the new AI agent to match the response to a specific pending action
    const matchResult = await matchResponseToAction(message, pendingActions);

    if (!matchResult || !matchResult.matched_action_id) {
        // The user's message is not a direct reply to any pending question.
        return null;
    }

    const matchedAction = pendingActions.find(a => a.action_id === matchResult.matched_action_id);
    if (!matchedAction) {
        // This should rarely happen, but it's a good safeguard.
        return null;
    }

    // Now, classify the intent of the message for the matched action.
    const intent = await classifyUserIntent(message, matchedAction.details.reason);

    if (intent.intent === 'UNCLEAR') {
        // Let the main agent handle the clarification. Don't resolve the action yet.
        return null;
    }

    // If intent is clear, resolve the action by removing it from the stack.
    await removePendingAction(matchedAction.action_id);

    if (intent.intent === 'CONSENT_GRANTED') {
        return {
            action: 'execute',
            details: matchedAction.details,
            reply: "[Personal Note] Thank you. I've acted on your request."
        };
    } else { // CONSENT_DENIED
        return {
            action: 'cancel',
            reply: "[Personal Note] Understood. I will not share it."
        };
    }
}

