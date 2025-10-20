/**
 * @fileoverview AI Integration for Simulations
 * Connects simulations to the AI system using separate database
 */

import { handleMessage } from '../../handlers/messageHandler.js';
import { performAiAnalysis } from '../../handlers/message_logic/aiAnalysisHandler.js';
import { ORCHESTRATOR_ACTIONS } from '../../constants.js';

export class SimulationAI {
    constructor(simulationDb) {
        this.simulationDb = simulationDb;
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
            let circleId = userId; // Default to user ID for single-user scenarios
            
            if (multiUserContext) {
                const { patientUser } = multiUserContext;
                circleId = patientUser?.userId || userId;
            }
            
            console.log(`[SimulationAI] Calling system: ${userId} -> ${circleId}`);
            
            // Get user role from database
            const { getMemberInfo } = await import('../../db/index.js');
            const memberInfo = await getMemberInfo(userId, circleId);
            if (!memberInfo) {
                throw new Error(`User ${userId} is not a member of circle ${circleId}`);
            }
            
            // Get the actual AI analysis and response
            const analysis = await performAiAnalysis(userId, memberInfo.role, message, circleId);
            
            if (!analysis || !analysis.reply) {
                throw new Error("AI analysis failed to generate response");
            }
            
            console.log(`[SimulationAI] System responded: ${analysis.reply.substring(0, 100)}...`);
            
            return {
                agent_response: analysis.reply,
                orchestrator_action: { type: ORCHESTRATOR_ACTIONS.NONE },
                state_vector: {
                    intent: analysis.intent,
                    criticality: analysis.criticality,
                    privacyLevel: analysis.privacyLevel,
                    facts: analysis.facts || {}
                }
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