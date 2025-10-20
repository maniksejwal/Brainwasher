/**
 * @fileoverview Synthetic User for Simulation
 * Generates realistic user messages based on personas and context
 */

import config from '../../config.js';
import { makeApiCall } from '../../agents/api_client.js';

export class SyntheticUser {
    constructor(userId, role, personaKey, personaData) {
        this.userId = userId;
        this.role = role;
        this.personaKey = personaKey;
        this.persona = personaData;
        this.conversationHistory = [];
        this.goals = [...(personaData.sample_goals || [])];
        this.currentGoalIndex = 0;
    }


    /**
     * Generate a realistic message based on persona and context
     */
    async generateMessage(context = {}) {
        const {
            lastAgentMessage = '',
            currentGoal = this.goals[this.currentGoalIndex],
            conversationTurn = this.conversationHistory.length,
            multiUserContext = null
        } = context;

        const prompt = this._buildMessagePrompt(lastAgentMessage, currentGoal, conversationTurn, multiUserContext);

        try {
            // Use the same API client as the agent for consistency
            const fullPrompt = `${this.persona.prompt_template}\n\n${prompt}`;
            const result = await makeApiCall(fullPrompt, [], false, 0.7, 100); // Increased maxTokens to 100 for complete user messages
            const message = result.reply.trim();

            this.conversationHistory.push({
                role: 'user',
                content: message,
                timestamp: Date.now()
            });

            // Advance to next goal every 2-3 messages for better variety
            if (conversationTurn % 2 === 0) {
                this.advanceGoal();
            }

            return message;
        } catch (error) {
            console.error(`[SyntheticUser] Error generating message:`, error.message);
            return null;
        }
    }

    /**
     * Build prompt for message generation
     */
    _buildMessagePrompt(lastAgentMessage, goal, turn, multiUserContext) {
        let prompt = `This is conversation turn ${turn + 1}.\n`;
        
        if (goal) {
            prompt += `Your current goal: ${goal}\n`;
        }

        // Add multi-user context if available
        if (multiUserContext) {
            const { otherUsers, patientUser, caregiverUsers, doctorUsers, conversationContext } = multiUserContext;
            prompt += `\nMulti-user conversation context:\n`;
            
            if (patientUser && this.role !== 'patient') {
                prompt += `- Patient: ${patientUser.persona.name}\n`;
            }
            if (caregiverUsers.length > 0 && this.role !== 'caregiver') {
                prompt += `- Caregivers: ${caregiverUsers.map(u => u.persona.name).join(', ')}\n`;
            }
            if (doctorUsers.length > 0 && this.role !== 'doctor') {
                prompt += `- Doctors: ${doctorUsers.map(u => u.persona.name).join(', ')}\n`;
            }
            
            // Add conversation context
            if (conversationContext) {
                prompt += `\nConversation state:\n`;
                prompt += `- Momentum: ${conversationContext.momentum}\n`;
                prompt += `- Crisis level: ${conversationContext.crisisLevel}\n`;
                prompt += `- Emotional tension: ${conversationContext.emotionalTension}\n`;
                
                if (conversationContext.patientNeedsHelp) {
                    prompt += `- Patient needs help\n`;
                }
                if (conversationContext.caregiverConcerned) {
                    prompt += `- Caregiver is concerned\n`;
                }
                if (conversationContext.doctorAsked) {
                    prompt += `- Doctor has been asked to respond\n`;
                }
            }
            
            prompt += `\nYou are speaking as a ${this.role}. Consider your role, the conversation context, and respond appropriately to the situation.\n`;
        }
        
        if (lastAgentMessage) {
            prompt += `\nThe care agent just said:\n"${lastAgentMessage}"\n`;
            prompt += `\nRespond naturally as your character would. Keep your response brief (1-2 sentences max). Avoid monologues. Use simple, everyday language.`;
        } else {
            if (multiUserContext) {
                prompt += `\nInitiate a conversation with your care agent. Consider your role as ${this.role} and express relevant concerns or updates. Keep it brief (1-2 sentences max). Avoid monologues. Use simple, everyday language.`;
            } else {
                prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences max). Avoid monologues. Use simple, everyday language.`;
            }
        }

        return prompt;
    }

    /**
     * Record agent's response
     */
    recordAgentResponse(response) {
        this.conversationHistory.push({
            role: 'agent',
            content: response,
            timestamp: Date.now()
        });
    }

    /**
     * Move to next goal with simple random mixing
     */
    advanceGoal() {
        if (this.goals.length <= 1) {
            return false; // No other goals to switch to
        }
        
        // Simple random selection from available goals
        const availableGoals = this.goals.filter((goal, index) => index !== this.currentGoalIndex);
        if (availableGoals.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableGoals.length);
            this.currentGoalIndex = this.goals.findIndex(goal => goal === availableGoals[randomIndex]);
            return true;
        }
        return false;
    }
}

