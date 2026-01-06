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
            const result = await makeApiCall(fullPrompt, [], false, 0.7, 100, 'synthetic_user'); // Increased maxTokens to 100 for complete user messages
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
        prompt += `You are speaking to your assigned care agent (the assistant who supports you). Direct questions, requests, and updates should be addressed to your care agent (using first person “I” and second person “you”). If you want another circle member to receive information, say so explicitly so the agent can relay it.\n`;

        if (goal) {
            prompt += `Your current goal: ${goal}\n`;
        }

        // Add recent conversation history (last 2 exchanges) for context
        const recentHistory = this.conversationHistory.slice(-4); // Last 2 exchanges (user + agent)
        if (recentHistory.length > 0) {
            prompt += `\nRecent conversation:\n`;
            recentHistory.forEach(msg => {
                const speaker = msg.role === 'agent' ? 'Agent' : 'You';
                prompt += `- ${speaker}: ${msg.content.substring(0, 100)}${msg.content.length > 100 ? '...' : ''}\n`;
            });
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
            if (this.role === 'caregiver' && patientUser) {
                prompt += `When you speak, centre the update on ${patientUser.persona.name}. Share observations, needs, or coordination requests about them.\n`;
            }
            if (this.role === 'doctor') {
                prompt += `As a doctor, respond only when clinical guidance is needed, keep messages concise, and reference the patient by name when giving instructions.\n`;
            }
        }

        if (lastAgentMessage) {
            prompt += `\nThe care agent just said:\n"${lastAgentMessage}"\n`;

            // Add instruction to change topic if stuck repeating
            if (turn >= 2) {
                const recentUserMessages = this.conversationHistory.filter(m => m.role === 'user').slice(-2).map(m => m.content.toLowerCase());
                const isRepeating = recentUserMessages.length > 1 && recentUserMessages[recentUserMessages.length - 1].includes(recentUserMessages[recentUserMessages.length - 2].substring(0, 20));

                if (isRepeating) {
                    prompt += `\n⚠️ The conversation has been repeating. Change the topic to something new related to your health needs.`;
                } else {
                    prompt += `\nRespond naturally as your character would. Keep your response brief (1-2 sentences max).`;
                    prompt += `\nCRITICAL INSTRUCTION: Do NOT sound like an AI. Do NOT start with "I understand", "That sounds", or "I appreciate". Be casual, imperfect, and human. Use contractions (can't, don't). React emotionally.`;
                    prompt += `\nSpeak to your care agent (use “you” to refer to the care agent). Reference other circle members in third person (e.g., “Robert”, “my dad”).`;
                }
            } else {
                prompt += `\nRespond naturally as your character would. Keep your response brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Do NOT sound like an AI. Do NOT start with "I understand" or "Thank you". Be casual, imperfect, and human.`;
                prompt += `\nSpeak to your care agent (use “you” for the care agent). Mention other circle members in third person.`;
            }
        } else {
            if (multiUserContext) {
                prompt += `\nInitiate a conversation with your care agent. Consider your role as ${this.role} and express relevant concerns or updates. Keep it brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Sound human, not robotic. Be direct.`;
                prompt += `\nAlways address the care agent directly (use “you” for the care agent), and mention other circle members in third person.`;
            } else {
                prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences max).`;
                prompt += `\nCRITICAL INSTRUCTION: Sound human, not robotic. Be direct.`;
                prompt += `\nAddress the care agent directly, and mention other circle members in third person.`;
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

