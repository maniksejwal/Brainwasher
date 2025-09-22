/**
 * @fileoverview This module manages the short-term conversational state for each user,
 * particularly for handling multi-step interactions like a stack of pending questions.
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

export async function createSharingConsentAction(userId, circleId, suggestion, actionType = 'share_consent') {
    const actionId = randomUUID();
    await addPendingAction(actionId, circleId, userId, actionType, suggestion);
    return actionId;
}

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

    const intent = await classifyUserIntent(message, matchedAction.details.reason);
    if (intent.intent === 'UNCLEAR') {
        return null;
    }

    await removePendingAction(matchedAction.action_id);

    if (intent.intent === 'CONSENT_GRANTED') {
        // NEW: Handle the specific action for an implied context switch.
        if (matchedAction.action_type === 'implied_switch_consent') {
            const { originatingUser, originalMessage, targetCircleId, targetPatientUsername } = matchedAction.details;
            const originatingUserInfo = await findUserById(originatingUser);
            // This is the core action: log the original message into the TARGET circle.
            await addMessage(targetCircleId, originatingUser, 'contextual_note', `(Regarding ${targetPatientUsername}): ${originalMessage}`, 'PRIVATE', 'NONE');
            console.log(`[StateManager] Logged message from ${originatingUserInfo.username} into circle ${targetCircleId}`);
            return {
                action: 'execute',
                details: null, // The action is self-contained, no further details needed for the handler.
                reply: `[Personal Note] Thank you. I've logged that note in ${targetPatientUsername}'s circle.`
            };
        } else { // Default 'share_consent'
            return {
                action: 'execute',
                details: matchedAction.details,
                reply: "[Personal Note] Thank you. I've acted on your request."
            };
        }
    } else { // CONSENT_DENIED
        return {
            action: 'cancel',
            reply: "[Personal Note] Understood. I will not log it."
        };
    }
}

