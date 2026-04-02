// This file is the central event emitter and dispatcher.
import { EventEmitter } from 'events';
// FIX: Update import path to the new db package index
import { clearDatabase, findUserById, findCircleByPatientId, getCircleMembers, addEscalation } from './db/index.js';

// Import the context-aware companion router for intelligent context sharing
import { handleLogin } from './handlers/loginHandler.js';
import { handleCommand } from './handlers/commandHandler.js';
import { handleMessage } from './handlers/messageHandler.js';
import { routeMessage } from './handlers/contextAwareCompanionRouter.js';

// The orchestrator's main job is to provide a central event bus.
export const events = new EventEmitter();

// Listen for a 'clear_db' event and call the database function.
events.on('clear_db', clearDatabase);

// Listen for future plan execution events
events.on('future_plan_executed', async (planData) => {
    console.log(`[Orchestrator] Future plan executed: ${planData.planType} - ${planData.description}`);
    
    try {
        // Get user and circle info (using static imports from top of file)
        const user = await findUserById(planData.userId);
        const circle = await findCircleByPatientId(planData.circleId);
        const members = await getCircleMembers(planData.circleId);
        
        // Execute based on plan type
        switch (planData.planType) {
            case 'question':
                // Ask the user a question from the plan description
                events.emit('broadcast', {
                    targetUsers: [planData.userId],
                    message: planData.description,
                    from: 'agent',
                    circleId: planData.circleId,
                    source: 'future_plan_question'
                });
                break;
                
            case 'follow_up':
                // Send a follow-up message
                events.emit('broadcast', {
                    targetUsers: [planData.userId],
                    message: planData.description,
                    from: 'agent',
                    circleId: planData.circleId,
                    source: 'future_plan_followup'
                });
                break;
                
            case 'reminder':
                // Send a reminder
                events.emit('broadcast', {
                    targetUsers: [planData.userId],
                    message: `Reminder: ${planData.description}`,
                    from: 'agent',
                    circleId: planData.circleId,
                    source: 'future_plan_reminder'
                });
                break;
                
            case 'escalation':
                // Trigger an escalation (using static import from top of file)
                await addEscalation(planData.circleId, 'INFO', planData.description);
                events.emit('escalate', { circleId: planData.circleId });
                break;
                
            default:
                // Generic plan execution - send message from description
                events.emit('broadcast', {
                    targetUsers: [planData.userId],
                    message: planData.description,
                    from: 'agent',
                    circleId: planData.circleId,
                    source: 'future_plan_generic'
                });
        }
    } catch (error) {
        console.error(`[Orchestrator] Error executing future plan ${planData.planId}:`, error.message);
    }
});

// Export the handlers and unified router so the server can use them.
export { handleLogin, handleCommand, handleMessage, routeMessage };

