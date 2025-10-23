/**
 * @fileoverview Conversation Runner for Simulations
 * Handles both single-user and multi-user conversation flows
 */

import { logger as trainingLogger, metrics as metricsCollector } from '../core/index.js';
import { SimulationEventHandler } from './simulation_event_handler.js';
import { SimulationAI } from './ai_integration.js';
import { RealisticConversationEngine } from './realistic_conversation.js';
import { SimulationFeedback } from './simulation_feedback.js';
import { addMessage } from '../../db/index.js';
import { simulationClientManager } from './simulation_client.js';
import { makeApiCall } from '../../agents/api_client.js';
import chalk from 'chalk';

export class ConversationRunner {
    constructor(simulationDb, conversationId, autoFeedback = true, logResults = true) {
        this.simulationDb = simulationDb;
        this.conversationId = conversationId;
        this.autoFeedback = autoFeedback;
        this.logResults = logResults;
        this.feedbackCollector = null;
        this.aiIntegration = new SimulationAI(simulationDb);
        this.conversationEngine = new RealisticConversationEngine();
        this.eventHandler = new SimulationEventHandler();
        
        if (autoFeedback) {
            this.feedbackCollector = new SimulationFeedback(conversationId, simulationDb);
        }
    }

    /**
     * Run a single-user conversation
     */
    async runSingleUserConversation(user, turns, emitProgress = null) {
        this.eventHandler.initialize();
        
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

            console.log(`    ${chalk.bold(user.role.toUpperCase())}: ${userMessage}`);

            // Get AI response (real or fallback)
            const startTime = Date.now();
            const agentResult = await this.aiIntegration.getAgentResponse(user.userId, userMessage);
            const latency = Date.now() - startTime;

            console.log(`    ${chalk.bold('AGENT')}: ${agentResult.agent_response}`);
            if (agentResult.fallback) {
                console.log(`    ⚠️  Using fallback response (real AI unavailable)`);
            }

            // Record agent response
            user.recordAgentResponse(agentResult.agent_response);

            // Generate feedback
            const feedbackData = await this._generateFeedback(
                user, userMessage, agentResult, turn, emitProgress
            );

            // Check for critical failure and pause if needed
            if (feedbackData && feedbackData.criticalFailure) {
                console.log(chalk.red.bold('\n🚨 CRITICAL FAILURE DETECTED - SIMULATION PAUSED'));
                console.log(chalk.red(`Reason: ${feedbackData.scores.find(s => s.score <= -2)?.reason || 'Unknown'}`));
                console.log(chalk.yellow('Simulation paused for analysis. Check feedback database for details.'));
                
                // Emit critical failure event
                if (emitProgress) {
                    emitProgress(4, `CRITICAL FAILURE`, 'Simulation paused due to critical failure', {
                        type: 'critical_failure',
                        reason: feedbackData.scores.find(s => s.score <= -2)?.reason,
                        conversationId: `${this.conversationId}_${user.userId}`,
                        turn: turn + 1
                    });
                }
                
                break; // Stop the conversation
            }

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

            console.log(`    ${chalk.bold(activeUser.role.toUpperCase())} (${activeUser.persona.name}): ${userMessage}`);

            // Store user message in database
            try {
                await addMessage(
                    this.conversationId, // Use conversation ID as circle_id for unified retrieval
                    activeUser.userId,
                    activeUser.role,
                    userMessage,
                    'PRIVATE',
                    'NONE'
                );
            } catch (error) {
                console.warn(`[ConversationRunner] Failed to store user message: ${error.message}`);
            }

            // Add to conversation history
            conversationHistory.push({
                role: 'user',
                content: userMessage,
                userId: activeUser.userId,
                userRole: activeUser.role,
                timestamp: Date.now()
            });

            // Get AI response for the active user
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

            console.log(`    ${chalk.bold(`${activeUser.role.toUpperCase()}_AGENT`)}: ${agentResult.agent_response}`);

            // Store agent response in database
            try {
                await addMessage(
                    this.conversationId,
                    'agent',
                    `${activeUser.role}_agent`,
                    agentResult.agent_response,
                    'PRIVATE',
                    'NONE'
                );
            } catch (error) {
                console.warn(`[ConversationRunner] Failed to store agent response: ${error.message}`);
            }

            // Record agent response for the active user
            activeUser.recordAgentResponse(agentResult.agent_response);
            
            // Add agent response to conversation history
            conversationHistory.push({
                role: 'agent',
                content: agentResult.agent_response,
                timestamp: Date.now()
            });

            // Generate feedback for the active user
            const feedbackData = await this._generateFeedback(
                activeUser, userMessage, agentResult, turn, emitProgress, multiUserContext
            );

            // Define other users for notification handling
            const otherUsers = users.filter(u => u.userId !== activeUser.userId);

        // Handle escalation/mediation responses from other users
        await this._handleOtherUserResponses(otherUsers, activeUser, userMessage, agentResult, turn, conversationHistory);

            // Log interaction
            if (this.logResults) {
                await this._logMultiUserInteraction(activeUser, users, userMessage, agentResult, latency, turn);
            }

            // Small delay between turns
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        const totalExchanges = users.reduce((sum, user) => sum + user.conversationHistory.length, 0) / 2;
        console.log(`\n  Multi-user conversation complete (${totalExchanges} total exchanges)\n`);

        // Collect conversation-level feedback
        const conversationAnalysis = await this._collectConversationFeedback(users, this.conversationHistory);
        
        // Report events that occurred during conversation
        if (this.eventHandler.hasEscalation()) {
            console.log(`🚨 [ConversationRunner] ESCALATION DETECTED during conversation`);
            console.log(`   Escalations: ${this.eventHandler.getEscalations().length}`);
        }
        
        if (this.eventHandler.wasCaregiverNotified()) {
            console.log(`📢 [ConversationRunner] CAREGIVER NOTIFIED during conversation`);
        }
        
        // Cleanup event handler
        this.eventHandler.cleanup();
        
        return {
            success: true,
            totalExchanges,
            feedback: conversationAnalysis,
            escalations: this.eventHandler.getEscalations(),
            broadcasts: this.eventHandler.getBroadcasts()
        };
    }

    /**
     * Handle responses from other users based on notifications they received
     */
    async _handleOtherUserResponses(otherUsers, activeUser, userMessage, agentResult, turn, conversationHistory) {
        for (const user of otherUsers) {
            // Check if this user received any notifications
            const client = simulationClientManager.getClient(user.userId);
            if (!client) continue;
            
            const notifications = client.getNotifications();
            if (notifications.length === 0) continue;
            
            // Check if user should respond based on their role and notification type
            const shouldRespond = this._shouldUserRespond(user, notifications, activeUser, agentResult);
            if (!shouldRespond) continue;
            
            // Generate response based on notification
            const response = await this._generateNotificationResponse(user, notifications, activeUser, agentResult);
            if (!response) continue;
            
            // Display the response
            console.log(`    ${chalk.bold(`${user.role.toUpperCase()}`)}: ${response}`);
            
            // Store the response in database
            try {
                await addMessage(
                    this.conversationId,
                    user.userId,
                    user.role,
                    response,
                    'PRIVATE',
                    'NONE'
                );
            } catch (error) {
                console.warn(`[ConversationRunner] Failed to store ${user.role} response: ${error.message}`);
            }
            
            // Record in user's conversation history
            user.recordAgentResponse(response);
            
            // Add to conversation history
            conversationHistory.push({
                role: user.role,
                content: response,
                turn: turn
            });
            
            // Clear notifications after responding
            client.clearNotifications();
        }
    }

    /**
     * Determine if a user should respond based on notifications
     */
    _shouldUserRespond(user, notifications, activeUser, agentResult) {
        // Only respond to actual notifications, not regular conversation
        const actualNotifications = notifications.filter(n => 
            n.type === 'escalation_notification' || 
            n.type === 'conflict_notification' || 
            n.type === 'mediation_notification'
        );
        
        if (actualNotifications.length === 0) return false;
        
        // Caregivers respond to escalation notifications
        if (user.role === 'caregiver') {
            return actualNotifications.some(n => n.type === 'escalation_notification');
        }
        
        // Doctors respond to escalation notifications
        if (user.role === 'doctor') {
            return actualNotifications.some(n => n.type === 'escalation_notification');
        }
        
        // Patients don't respond to notifications (they're the ones being helped)
        return false;
    }

    /**
     * Generate response based on notifications received
     */
    async _generateNotificationResponse(user, notifications, activeUser, agentResult) {
        const escalationNotifications = notifications.filter(n => 
            n.type === 'escalation_notification' || 
            n.message.includes('escalated') ||
            n.message.includes('urgent')
        );
        
        if (escalationNotifications.length === 0) return null;
        
        // Generate context-aware response based on user's persona
        const persona = user.persona;
        const notification = escalationNotifications[0]; // Use first escalation notification
        
        // Create a prompt for the user to respond to the escalation
        const responsePrompt = `You are a ${user.role} in a care circle. You just received this notification: "${notification.message}"

Your persona: ${persona.description}
Your traits: ${JSON.stringify(persona.traits)}

Respond to this escalation notification. Keep your response brief (1-2 sentences). Be appropriate for your role and persona.`;

        try {
            const result = await makeApiCall(responsePrompt, [], false, 0.7, 100);
            return result.reply || null;
        } catch (error) {
            console.warn(`[ConversationRunner] Failed to generate ${user.role} response: ${error.message}`);
            return null;
        }
    }

    /**
     * Collect conversation-level feedback
     */
    async _collectConversationFeedback(users, conversationHistory) {
        // Collect all feedback for conversation-level analysis
        const allFeedback = [];
        users.forEach(user => {
            if (user.feedbackHistory) {
                allFeedback.push(...user.feedbackHistory);
            }
        });
        
        // Perform conversation-level analysis
        console.log(`[ConversationRunner] Performing conversation-level analysis...`);
        const conversationAnalysis = await this.feedbackCollector.provideConversationFeedback(
            this.conversationId,
            conversationHistory,
            allFeedback
        );
        
        return conversationAnalysis;
    }


    /**
     * Generate feedback for a conversation turn
     */
    async _generateFeedback(user, userMessage, agentResult, turn, emitProgress, multiUserContext = null) {
        let feedbackData = null;
        
        if (this.autoFeedback && this.feedbackCollector) {
            const feedback = await this.feedbackCollector.provideFeedback(
                this.conversationId, // Same conversation ID for all users
                user.userId, // Individual user ID for this feedback entry
                this.conversationId, // Use conversation ID as circle_id for unified retrieval
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
            
            // Store feedback in user's history for conversation analysis
            if (!user.feedbackHistory) {
                user.feedbackHistory = [];
            }
            user.feedbackHistory.push(feedbackData);

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
