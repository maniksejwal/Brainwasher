// FIX: Update import path to the new db package index
import {
    addPendingAction,
    getPendingAction,
    removePendingAction,
    updateUserState,
    getUserState
} from './db/index.js';
import { randomUUID } from 'crypto';
import { classifyUserIntent } from './agents.js';

export async function createSharingConsentAction(userId, circleId, sharingSuggestion) {
    const actionId = randomUUID();
    await addPendingAction(actionId, circleId, userId, 'share_consent', sharingSuggestion);
    await updateUserState(userId, circleId, { session_state: 'AWAITING_CONSENT', pending_action_id: actionId });
    return actionId;
}

export async function handleUserResponseToAction(userId, circleId, message) {
    const state = await getUserState(userId, circleId);

    if (state.session_state !== 'AWAITING_CONSENT' || !state.pending_action_id) {
        return null;
    }

    const pendingAction = await getPendingAction(state.pending_action_id);
    if (!pendingAction || pendingAction.circle_id !== circleId) {
        await updateUserState(userId, circleId, { session_state: 'IDLE', pending_action_id: null });
        return null;
    }

    const intent = await classifyUserIntent(message, pendingAction.details.reason);

    if (intent.intent === 'UNCLEAR') {
        return null;
    }

    await removePendingAction(pendingAction.action_id);
    await updateUserState(userId, circleId, { session_state: 'IDLE', pending_action_id: null });

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

