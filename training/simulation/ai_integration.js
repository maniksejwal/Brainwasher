/**
 * @fileoverview AI Integration for Simulations
 * Connects simulations to the AI system using separate database
 */

// Use dynamic imports to avoid circular dependency with getRecentMessages
// import { handleMessage } from '../../handlers/messageHandler.js';
import { handleCommand } from '../../handlers/commandHandler.js';
import { performAiAnalysis } from '../../handlers/message_logic/aiAnalysisHandler.js';
import { ORCHESTRATOR_ACTIONS } from '../../constants.js';

import { setGlobalDb, getDb } from '../../db/index.js';

/**
 * Derive the orchestrator action actually executed during a turn by inspecting
 * escalations and pending actions written to the DB since `since`.
 * Sharing handlers don't return action results, so the DB is the source of truth.
 */
export async function detectExecutedActions(circleId, since) {
    const db = await getDb();
    const escalations = await db.all(
        'SELECT type, details FROM escalations WHERE circle_id = ? AND timestamp >= ?',
        [circleId, since]
    );
    const pending = await db.all(
        'SELECT action_type, user_id FROM pending_actions WHERE circle_id = ? AND created_at >= ?',
        [circleId, since]
    );

    let type = ORCHESTRATOR_ACTIONS.NONE;
    if (escalations.length > 0) {
        type = ORCHESTRATOR_ACTIONS.ESCALATE;
    } else if (pending.some(p => /permission|consent/i.test(p.action_type))) {
        type = ORCHESTRATOR_ACTIONS.REQUEST_CONSENT;
    } else if (pending.length > 0) {
        type = ORCHESTRATOR_ACTIONS.SHARE;
    }

    return {
        type,
        escalations: escalations.map(e => e.type),
        pending_actions: pending.map(p => p.action_type)
    };
}

export class SimulationAI {
    constructor(simulationDb) {
        this.simulationDb = simulationDb;
        // Inject the simulation DB into the global scope so handlers use it
        if (simulationDb) {
            setGlobalDb(simulationDb);
        }
    }

    /**
     * Get agent response
     * Uses separate simulation database - no production interference
     */
    async getAgentResponse(userId, message, multiUserContext = null) {
        // Suppress verbose simulation logs
        const originalConsoleLog = console.log;
        console.log = (...args) => {
            const message = args.join(' ');
            if (message.includes('[AIAnalysisHandler]') ||
                message.includes('[SimulationAI]') ||
                message.includes('Step 1:') ||
                message.includes('Initial analysis complete') ||
                message.includes('State for') ||
                message.includes('System responded:') ||
                message.includes('🔄 [Simulation] Analysis:') ||
                message.includes('📢 [Simulation] BROADCAST:')) {
                return; // Suppress these logs
            }
            originalConsoleLog(...args);
        };

        try {
            // Determine circle ID from context
            // Use explicit circleId if provided, otherwise infer from context
            let circleId = multiUserContext?.circleId;

            if (!circleId) {
                // Fallback to inferring from context
                circleId = userId; // Default to user ID for single-user scenarios

                if (multiUserContext) {
                    const { patientUser } = multiUserContext;
                    circleId = patientUser?.userId || userId;
                }
            }

            console.log(`[SimulationAI] Calling system: ${userId} -> ${circleId}`);

            // Check if this is a command - handle separately for simulations
            if (message.startsWith('/')) {
                // Use simulation database if available, otherwise fall back to production
                let memberInfo;
                if (this.simulationDb) {
                    memberInfo = await this.simulationDb.get(
                        'SELECT * FROM care_circle_members WHERE user_id = ? AND circle_id = ?',
                        [userId, circleId]
                    );
                } else {
                    const { getMemberInfo } = await import('../../db/index.js');
                    memberInfo = await getMemberInfo(userId, circleId);
                }

                if (!memberInfo) {
                    throw new Error(`User ${userId} is not a member of circle ${circleId}`);
                }

                // Handle command in simulations
                await handleCommand(userId, circleId, message);

                // Small delay after command handling
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Return command response
                return {
                    agent_response: `Command processed: "${message}"`,
                    orchestrator_action: { type: ORCHESTRATOR_ACTIONS.NONE },
                    state_vector: {
                        intent: 'COMMAND',
                        criticality: 'NONE',
                        privacyLevel: 'PRIVATE',
                        facts: {}
                    }
                };
            }

            // Small delay between API calls to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));

            // Get user role from database
            // Use simulation database if available, otherwise fall back to production
            let memberInfo;
            if (this.simulationDb) {
                // Query simulation database directly
                memberInfo = await this.simulationDb.get(
                    'SELECT * FROM care_circle_members WHERE user_id = ? AND circle_id = ?',
                    [userId, circleId]
                );
            } else {
                const { getMemberInfo } = await import('../../db/index.js');
                memberInfo = await getMemberInfo(userId, circleId);
            }

            if (!memberInfo) {
                throw new Error(`User ${userId} is not a member of circle ${circleId}`);
            }

            // Use the REAL system flow - call handleMessage which does everything:
            // 1. AI Analysis (performAiAnalysis)
            // 2. Escalation/Mediation (handleSharingAndEscalation) 
            // 3. Fact Processing (handleFactProcessing)
            // 4. All orchestrator events and cross-messaging
            // Use dynamic import to avoid circular dependency with getRecentMessages
            const { handleMessage } = await import('../../handlers/messageHandler.js');
            const turnStartedAt = Date.now();
            const analysis = await handleMessage(userId, circleId, message);

            if (!analysis || !analysis.reply) {
                throw new Error("AI analysis failed to generate response");
            }

            console.log(`[SimulationAI] System responded: ${analysis.reply.substring(0, 100)}...`);

            return {
                agent_response: analysis.reply,
                orchestrator_action: await detectExecutedActions(circleId, turnStartedAt),
                state_vector: {
                    intent: analysis.intent,
                    criticality: analysis.criticality,
                    privacyLevel: analysis.privacyLevel,
                    facts: analysis.facts || {}
                },
                future_plan: analysis.future_plan || null,
                // Data Quality Fields
                reasoning: analysis.reasoning || null,
                outcome_label: analysis.outcome_label || null,
                // Model Tracking
                model_used: analysis.model_used || 'unknown',
                model_provider: analysis.model_provider || 'unknown',
                system_used: analysis.system_used || 'unknown',
                analysis: analysis // Pass full analysis for completeness
            };

        } catch (error) {
            // Restore original console.log
            console.log = originalConsoleLog;
            console.error(`[SimulationAI] System failed: ${error.message}`);

            // If AI fails, this is a SYSTEM FAILURE - not a simulation issue
            throw new Error(`Simulation failed due to AI system error: ${error.message}`);
        }
    }
}