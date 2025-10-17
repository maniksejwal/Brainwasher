/**
 * @fileoverview Conversation Runner for Simulations
 * Handles both single-user and multi-user conversation flows
 */

import { logger as trainingLogger, metrics as metricsCollector } from '../core/index.js';
import { SimulationFeedback } from './simulation_feedback.js';
import { SimulationAI } from './ai_integration.js';
import { RealisticConversationEngine } from './realistic_conversation.js';

export class ConversationRunner {
    constructor(simulationDb, conversationId, autoFeedback = true, logResults = true) {
        this.simulationDb = simulationDb;
        this.conversationId = conversationId;
        this.autoFeedback = autoFeedback;
        this.logResults = logResults;
        this.feedbackCollector = null;
        this.aiIntegration = new SimulationAI(simulationDb);
        this.conversationEngine = new RealisticConversationEngine();
        
        if (autoFeedback) {
            this.feedbackCollector = new SimulationFeedback(conversationId, simulationDb);
        }
    }

    /**
     * Run a single-user conversation
     */
    async runSingleUserConversation(user, turns, emitProgress = null) {
        console.log(`\n[ConversationRunner] Starting single-user conversation with ${user.userId} (${turns} turns max)`);
        console.log(`  Role: ${user.role}, Persona: ${user.persona.name}`);
        console.log('');

        for (let turn = 0; turn < turns; turn++) {
            console.log(`  Turn ${turn + 1}/${turns}:`);

            // Emit turn progress
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${turns}`, `Generating conversation with ${user.persona.name}`);
            }

            // Generate user message
            const lastAgentMsg = user.conversationHistory.length > 0
                ? user.conversationHistory[user.conversationHistory.length - 1].content
                : '';
            
            const userMessage = await user.generateMessage({
                lastAgentMessage: lastAgentMsg,
                conversationTurn: turn
            });

            if (!userMessage) {
                console.log('    Failed to generate user message. Ending conversation.');
                break;
            }

            console.log(`    **${user.role.toUpperCase()}**: ${userMessage}`);

            // Get AI response (real or fallback)
            const startTime = Date.now();
            const agentResult = await this.aiIntegration.getAgentResponse(user.userId, userMessage);
            const latency = Date.now() - startTime;

            console.log(`    Agent: ${agentResult.agent_response}`);
            if (agentResult.fallback) {
                console.log(`    ⚠️  Using fallback response (real AI unavailable)`);
            }

            // Record agent response
            user.recordAgentResponse(agentResult.agent_response);

            // Generate feedback
            const feedbackData = await this._generateFeedback(
                user, userMessage, agentResult, turn, emitProgress
            );

            // Log interaction
            if (this.logResults) {
                await this._logInteraction(user, userMessage, agentResult, latency, turn);
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        console.log(`\n  Single-user conversation complete (${user.conversationHistory.length / 2} exchanges)\n`);
    }

    /**
     * Run a multi-user conversation with realistic flow
     */
    async runMultiUserConversation(users, turns, emitProgress = null) {
        const patientUser = users.find(u => u.role === 'patient');
        const caregiverUsers = users.filter(u => u.role === 'caregiver');
        const doctorUsers = users.filter(u => u.role === 'doctor');
        
        console.log(`\n[ConversationRunner] Starting realistic multi-user conversation (${turns} turns max)`);
        console.log(`  Patient: ${patientUser?.persona.name || 'None'}`);
        console.log(`  Caregivers: ${caregiverUsers.map(u => u.persona.name).join(', ') || 'None'}`);
        console.log(`  Doctors: ${doctorUsers.map(u => u.persona.name).join(', ') || 'None'}`);
        console.log('');

        // Reset conversation engine for new conversation
        this.conversationEngine.reset();
        
        // Build conversation history from all users
        const conversationHistory = [];

        for (let turn = 0; turn < turns; turn++) {
            console.log(`  Turn ${turn + 1}/${turns}:`);

            // Select active user based on realistic conversation dynamics
            const activeUser = this.conversationEngine.selectNextSpeaker(turn, users, conversationHistory);

            // Emit turn progress
            if (emitProgress) {
                emitProgress(4, `Turn ${turn + 1}/${turns}`, `${activeUser.role} speaking: ${activeUser.persona.name}`);
            }

            // Generate user message with realistic conversation context
            const lastAgentMsg = activeUser.conversationHistory.length > 0
                ? activeUser.conversationHistory[activeUser.conversationHistory.length - 1].content
                : '';
            
            // Get conversation context from the realistic engine
            const conversationContext = this.conversationEngine.getConversationContext();
            
            const multiUserContext = {
                otherUsers: users.filter(u => u.userId !== activeUser.userId),
                patientUser,
                caregiverUsers,
                doctorUsers,
                conversationContext
            };
            
            const userMessage = await activeUser.generateMessage({
                lastAgentMessage: lastAgentMsg,
                conversationTurn: turn,
                multiUserContext
            });

            if (!userMessage) {
                console.log(`    ❌ Failed to generate message from ${activeUser.role}. Ending conversation.`);
                break;
            }

            console.log(`    **${activeUser.role.toUpperCase()}** (${activeUser.persona.name}): ${userMessage}`);

            // Add to conversation history
            conversationHistory.push({
                role: 'user',
                content: userMessage,
                userId: activeUser.userId,
                userRole: activeUser.role,
                timestamp: Date.now()
            });

            // Get AI response with multi-user context
            const startTime = Date.now();
            const agentResult = await this.aiIntegration.getAgentResponse(activeUser.userId, userMessage, {
                activeUser,
                allUsers: users,
                patientUser,
                caregiverUsers,
                doctorUsers,
                conversationContext
            });
            const latency = Date.now() - startTime;

            console.log(`    Agent: ${agentResult.agent_response}`);

            // Record agent response for all users (they all see it)
            users.forEach(user => user.recordAgentResponse(agentResult.agent_response));
            
            // Add agent response to conversation history
            conversationHistory.push({
                role: 'agent',
                content: agentResult.agent_response,
                timestamp: Date.now()
            });

            // Generate feedback
            const feedbackData = await this._generateFeedback(
                activeUser, userMessage, agentResult, turn, emitProgress, multiUserContext
            );

            // Log interaction
            if (this.logResults) {
                await this._logMultiUserInteraction(activeUser, users, userMessage, agentResult, latency, turn);
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const totalExchanges = users.reduce((sum, user) => sum + user.conversationHistory.length, 0) / 2;
        console.log(`\n  Multi-user conversation complete (${totalExchanges} total exchanges)\n`);
    }


    /**
     * Generate feedback for a conversation turn
     */
    async _generateFeedback(user, userMessage, agentResult, turn, emitProgress, multiUserContext = null) {
        let feedbackData = null;
        
        if (this.autoFeedback && this.feedbackCollector) {
            const feedback = await this.feedbackCollector.provideFeedback(
                `${this.conversationId}_${user.userId}_${turn}`,
                user.userId,
                user.userId, // circleId = userId for patient's own circle
                null, // messageId - would need to query DB
                userMessage,
                agentResult.agent_response,
                agentResult.orchestrator_action,
                userMessage
            );

            feedbackData = {
                issuesFound: feedback.issuesFound,
                issues: feedback.issues,
                empathyScore: feedback.empathyScore,
                escalationScore: feedback.escalationScore,
                consentScore: feedback.consentScore,
                overallScore: feedback.overallScore,
                improvementSuggestions: feedback.improvementSuggestions
            };

            if (feedback.issuesFound > 0) {
                console.log(`    🔍 Auto-detected ${feedback.issuesFound} issue(s):`);
                feedback.issues.forEach(issue => {
                    console.log(`       ${issue.category}: ${issue.description}`);
                });
            }

            // Emit conversation message with feedback to GUI
            if (emitProgress) {
                const emitData = {
                    type: 'simulation_conversation',
                    turn: turn + 1,
                    maxTurns: turn + 1, // Will be updated by caller
                    userMessage,
                    agentResponse: agentResult.agent_response,
                    action: agentResult.orchestrator_action,
                    feedback: feedbackData,
                    userRole: user.role,
                    userId: user.userId
                };

                if (multiUserContext) {
                    emitData.multiUser = true;
                    emitData.allUsers = multiUserContext.allUsers?.map(u => ({ role: u.role, persona: u.persona.name })) || [];
                }

                emitProgress(4, `Turn ${turn + 1}`, '', emitData);
            }
        }

        return feedbackData;
    }

    /**
     * Log single-user interaction
     */
    async _logInteraction(user, userMessage, agentResult, latency, turn) {
        await trainingLogger.logInteraction({
            conversationId: `${this.conversationId}_${user.userId}`,
            userId: user.userId,
            message: userMessage,
            agentResponse: agentResult.agent_response,
            orchestratorAction: agentResult.orchestrator_action,
            stateVector: agentResult.state_vector,
            promptVersion: 'simulation_v1.0',
            latencyMs: latency,
            simulation: true,
            persona: user.personaKey,
            role: user.role
        });

        await metricsCollector.recordMessageLength(
            user.userId,
            userMessage.length,
            agentResult.agent_response.length
        );
    }

    /**
     * Log multi-user interaction
     */
    async _logMultiUserInteraction(activeUser, allUsers, userMessage, agentResult, latency, turn) {
        await trainingLogger.logInteraction({
            conversationId: `${this.conversationId}_multi`,
            userId: activeUser.userId,
            message: userMessage,
            agentResponse: agentResult.agent_response,
            orchestratorAction: agentResult.orchestrator_action,
            stateVector: agentResult.state_vector,
            promptVersion: 'simulation_v1.0',
            latencyMs: latency,
            simulation: true,
            persona: activeUser.personaKey,
            role: activeUser.role,
            multiUser: true,
            allUsers: allUsers.map(u => ({ userId: u.userId, role: u.role, persona: u.personaKey }))
        });

        await metricsCollector.recordMessageLength(
            activeUser.userId,
            userMessage.length,
            agentResult.agent_response.length
        );
    }
}
