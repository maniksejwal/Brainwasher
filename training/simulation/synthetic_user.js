/**
 * @fileoverview Synthetic User for Simulation
 * Generates realistic user messages based on personas and context
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';

export class SyntheticUser {
    constructor(userId, role, personaKey, personaData) {
        this.userId = userId;
        this.role = role;
        this.personaKey = personaKey;
        this.persona = personaData;
        this.conversationHistory = [];
        this.goals = [...(personaData.sample_goals || [])];
        this.currentGoalIndex = 0;
        
        // Initialize LLM client
        this._initializeLLM();
    }

    /**
     * Initialize LLM client (OpenAI or Gemini)
     */
    _initializeLLM() {
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        } else {
            throw new Error('No AI API keys configured for synthetic user generation');
        }
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
            let message;
            
            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [
                        { role: 'system', content: this.persona.prompt_template },
                        { role: 'user', content: prompt }
                    ],
                    temperature: 0.9, // Increased for more variety
                    max_tokens: 150
                });
                message = response.choices[0].message.content.trim();
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(
                    this.persona.prompt_template + '\n\n' + prompt
                );
                message = result.response.text().trim();
            }

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
            prompt += `\nRespond naturally as your character would. Keep your response brief (1-3 sentences).`;
        } else {
            if (multiUserContext) {
                prompt += `\nInitiate a conversation with your care agent. Consider your role as ${this.role} and express relevant concerns or updates. Keep it brief (1-2 sentences).`;
            } else {
                prompt += `\nInitiate a conversation with your care agent. Express a health concern or update. Keep it brief (1-2 sentences).`;
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
     * Move to next goal
     */
    advanceGoal() {
        if (this.currentGoalIndex < this.goals.length - 1) {
            this.currentGoalIndex++;
            return true;
        }
        return false;
    }
}

