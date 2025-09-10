import {
    addPendingAction,
    getPendingAction,
    removePendingAction,
    updateUserState,
    getUserState
} from './database.js';
import { randomUUID } from 'crypto';
import { classifyUserIntent } from './agents.js'; // Import the new agent

export async function createSharingConsentAction(userId, sharingSuggestion) {
    const actionId = randomUUID();
    await addPendingAction(actionId, userId, 'share_consent', sharingSuggestion);
    await updateUserState(userId, { session_state: 'AWAITING_CONSENT', pending_action_id: actionId });
    return actionId;
}

// ** FIX: This function is now much more intelligent **
export async function handleUserResponseToAction(userId, message) {
    const state = await getUserState(userId);

    if (state.session_state !== 'AWAITING_CONSENT' || !state.pending_action_id) {
        return null;
    }

    const pendingAction = await getPendingAction(state.pending_action_id);
    if (!pendingAction) {
        await updateUserState(userId, { session_state: 'IDLE', pending_action_id: null });
        return null;
    }

    // Use the AI to classify the user's intent
    const intent = await classifyUserIntent(message, pendingAction.details.reason);

    // If the AI is unsure, we don't act on it yet.
    if (intent.intent === 'UNCLEAR') {
        // The main agent's response will handle this by asking for clarification.
        // We keep the user in the AWAITING_CONSENT state.
        return null;
    }

    // If the intent is clear, we clear the action
    await removePendingAction(pendingAction.action_id);
    await updateUserState(userId, { session_state: 'IDLE', pending_action_id: null });

    if (intent.intent === 'CONSENT_GRANTED') {
        return {
            action: 'execute',
            details: pendingAction.details,
            reply: "[Personal Note] Thank you. I've acted on your request."
        };
    } else { // CONSENT_DENIED
        return {
            action: 'cancel',
            reply: "[Personal Note] Understood. I will not share it."
        };
    }
}

