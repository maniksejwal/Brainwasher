/**
 * @fileoverview handlers/message_logic/actionResponseHandler.js
 * This module checks if a user's natural language message is a reply to a
 * pending question from the AI, processes the response, and then uses the
 * actionExecutor to perform the resulting action.
 */

import { handleUserResponseToAction } from '../../state_manager.js';
import { executeResolvedAction } from './actionExecutor.js';

export async function handlePendingActionResponse(userId, circleId, message) {
    // This function now only handles natural language responses, not commands.
    if (message.startsWith('/')) return false;

    const actionResult = await handleUserResponseToAction(userId, circleId, message);

    if (!actionResult) {
        return false; // Indicates no pending action was handled
    }
    
    // Delegate the execution of the action to the shared executor module.
    await executeResolvedAction(actionResult, userId, circleId);
    
    return true; // Indicates a pending action was successfully handled
}

