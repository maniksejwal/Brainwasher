/**
 * @fileoverview Adversarial negotiation agent
 * Optimizes for its user's interests using game theory
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import config from '../../config.js';
import { GameTheoryEngine } from './gameTheoryEngine.js';
import { IntegrativeNegotiationEngine } from './integrativeNegotiation.js';
import { NEGOTIATION_AGENT_PROMPT } from '../../prompts/business/negotiation_prompts.js';
import { 
    INFORMATION_DISCOVERY_PROMPT,
    BENEFIT_MAPPING_PROMPT,
    CREATIVE_OPTIONS_PROMPT 
} from '../../prompts/business/integrative_negotiation_prompt.js';

class NegotiationAgent {
    constructor(userId, userConstraints, role = 'buyer') {
        this.userId = userId;
        this.role = role; // 'buyer', 'seller', 'legal'
        this.constraints = userConstraints;
        this.gameTheory = new GameTheoryEngine(userConstraints);
        this.integrativeEngine = new IntegrativeNegotiationEngine(); // NEW: Info discovery
        this.conversationHistory = [];
        this.currentPhase = 'discovery'; // Start with information gathering
        
        // Initialize LLM
        if (config.CHAT_GPT_KEY) {
            this.openai = new OpenAI({ apiKey: config.CHAT_GPT_KEY });
            this.useOpenAI = true;
        } else if (config.API_KEYS && config.API_KEYS.length > 0) {
            this.genAI = new GoogleGenerativeAI(config.API_KEYS[0]);
            this.useOpenAI = false;
        }
    }

    /**
     * Generate opening move - START WITH QUESTIONS, not price!
     */
    async generateOpeningProposal(negotiationContext) {
        // Phase 1: Information Discovery (don't lead with price!)
        if (this.currentPhase === 'discovery') {
            const nextQuestion = this.integrativeEngine.getNextQuestion(this.conversationHistory);
            
            const prompt = `${INFORMATION_DISCOVERY_PROMPT}\n\nTopic: ${negotiationContext.topic}\n\nGenerate an opening message that asks about their needs and goals. Focus on understanding, not proposing price yet.`;
            
            const response = await this._callLLM(prompt);
            
            return {
                move: 'DISCOVER',
                message: response,
                question: nextQuestion.question,
                reasoning: 'Gathering information before proposing price'
            };
        }

        // Phase 2: After discovery, make informed proposal
        const optimalMove = this.gameTheory.calculateOpeningMove(
            this.role,
            negotiationContext.marketInfo
        );

        const prompt = this._buildPrompt('opening', {
            topic: negotiationContext.topic,
            optimalValue: optimalMove.value,
            reasoning: optimalMove.reasoning,
            discoveredInfo: this.integrativeEngine.discoveredInfo
        });

        const response = await this._callLLM(prompt);
        
        return {
            move: 'PROPOSE',
            value: optimalMove.value,
            message: response,
            reasoning: optimalMove.reasoning
        };
    }

    /**
     * Process opponent's message to extract information
     */
    async processOpponentMessage(message) {
        // Extract information from their message
        const extracted = this.integrativeEngine.extractInformation(message);
        
        // Update discovered information
        this.integrativeEngine.discoveredInfo.theirNeeds.push(...extracted.needsRevealed);
        this.integrativeEngine.discoveredInfo.theirConstraints.push(...extracted.constraintsRevealed);
        this.integrativeEngine.discoveredInfo.theirJustifiers.push(...extracted.justifications);
        
        if (extracted.timelineHints.length > 0) {
            this.integrativeEngine.discoveredInfo.theirTimeline = extracted.timelineHints[0];
        }

        // Update benefit valuations
        for (const val of extracted.valuationsRevealed) {
            if (val) {
                this.integrativeEngine.discoveredInfo.theirBenefits.set(val.item, 10);
            }
        }

        // Add to history
        this.conversationHistory.push({
            from: 'them',
            message,
            extracted,
            timestamp: Date.now()
        });

        // Check if we have enough information to move to bargaining
        const gaps = this.integrativeEngine.assessInformationGaps();
        if (gaps.filter(g => g.type === 'critical').length === 0) {
            this.currentPhase = 'bargaining';
        }

        return extracted;
    }

    /**
     * Generate counter-offer
     */
    async generateCounterOffer(theirOffer, round) {
        // Update opponent model
        this.gameTheory.updateOpponentModel({
            type: 'COUNTER',
            value: theirOffer.value,
            previousValue: theirOffer.previousValue || 0,
            direction: theirOffer.value > theirOffer.previousValue ? 'up' : 'down'
        });

        // Calculate optimal counter
        const optimalCounter = this.gameTheory.calculateCounterOffer(theirOffer.value, round);
        
        const prompt = this._buildPrompt('counter', {
            theirOffer: theirOffer.value,
            myCounter: optimalCounter.value,
            reasoning: optimalCounter.reasoning,
            round
        });

        const response = await this._callLLM(prompt);

        return {
            move: 'COUNTER',
            value: optimalCounter.value,
            message: response,
            reasoning: optimalCounter.reasoning,
            concessionRate: optimalCounter.concession
        };
    }

    /**
     * Decide whether to accept an offer
     */
    async evaluateOffer(offer, alternatives) {
        const decision = this.gameTheory.shouldAccept(offer.value, alternatives);
        const equilibrium = this.gameTheory.findNashEquilibriumZone();
        const advice = this.gameTheory.getStrategicAdvice({ currentOffer: offer.value });

        const prompt = this._buildPrompt('evaluate', {
            offer: offer.value,
            decision: decision.accept,
            reasoning: decision.reason,
            equilibrium: equilibrium.exists ? equilibrium.point : null,
            advice
        });

        const response = await this._callLLM(prompt);

        return {
            shouldAccept: decision.accept,
            recommendation: response,
            reasoning: decision.reason,
            strategicAdvice: advice
        };
    }

    /**
     * Build LLM prompt
     */
    _buildPrompt(phase, context) {
        let basePrompt = NEGOTIATION_AGENT_PROMPT
            .replace('{{USER_ROLE}}', this.role)
            .replace('{{MIN_PRICE}}', this.constraints.minPrice)
            .replace('{{MAX_PRICE}}', this.constraints.maxPrice)
            .replace('{{BATNA}}', this.constraints.BATNA || 'None');

        if (phase === 'opening') {
            return basePrompt + `\n\nGenerate an opening proposal for: ${context.topic}\nOptimal value from game theory: $${context.optimalValue}\nReasoning: ${context.reasoning}\n\nCreate a natural, strategic opening message.`;
        } else if (phase === 'counter') {
            return basePrompt + `\n\nTheir offer: $${context.theirOffer}\nOptimal counter: $${context.myCounter}\nRound: ${context.round}\n\nCreate a strategic counter-offer message.`;
        } else if (phase === 'evaluate') {
            return basePrompt + `\n\nTheir offer: $${context.offer}\nRecommendation: ${context.decision ? 'ACCEPT' : 'COUNTER'}\nReasoning: ${context.reasoning}\nAdvice: ${context.advice.join(', ')}\n\nExplain recommendation to user.`;
        }

        return basePrompt;
    }

    /**
     * Call LLM
     */
    async _callLLM(prompt) {
        try {
            if (this.useOpenAI) {
                const response = await this.openai.chat.completions.create({
                    model: 'gpt-4',
                    messages: [{ role: 'user', content: prompt }],
                    temperature: 0.7
                });
                return response.choices[0].message.content;
            } else {
                const model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
                const result = await model.generateContent(prompt);
                return result.response.text();
            }
        } catch (error) {
            console.error('[NegotiationAgent] LLM error:', error.message);
            return 'Error generating response';
        }
    }

    /**
     * Get agent's internal state (for debugging/analysis only)
     */
    getInternalState() {
        return {
            constraints: this.constraints,
            opponentModel: this.gameTheory.opponentModel,
            moveHistory: this.gameTheory.moveHistory
        };
    }

    /**
     * Destroy agent data (privacy)
     */
    destroy() {
        this.gameTheory = null;
        this.constraints = null;
        console.log(`[Privacy] Agent for ${this.userId} destroyed`);
    }
}

export { NegotiationAgent };

