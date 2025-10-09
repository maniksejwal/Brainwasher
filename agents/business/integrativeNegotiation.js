/**
 * @fileoverview Integrative Negotiation Engine
 * Focuses on information discovery, benefits, and value creation
 * 
 * Based on Harvard Negotiation Project principles:
 * - Separate people from problem
 * - Focus on interests, not positions
 * - Generate options for mutual gain
 * - Use objective criteria
 */

class IntegrativeNegotiationEngine {
    constructor() {
        this.discoveredInfo = {
            theirNeeds: [],           // What do they actually need?
            theirConstraints: [],     // What limits them?
            theirTimeline: null,      // When do they need it?
            theirJustifiers: [],      // Why do they need it?
            theirBenefits: new Map(), // What do they value? (priority-weighted)
            ourBenefits: new Map(),   // What do we value?
            sharedInterests: [],      // Common goals
            tradeableIssues: []       // What can we trade?
        };
        
        this.questionStrategy = this._buildQuestionStrategy();
        this.currentPhase = 'discovery'; // 'discovery', 'ideation', 'bargaining', 'closing'
    }

    /**
     * Build strategic questioning plan
     */
    _buildQuestionStrategy() {
        return {
            discovery: [
                "What problem are you trying to solve?",
                "Why is this important to you?",
                "What's driving the timeline?",
                "What happens if you don't get this?",
                "What alternatives have you considered?",
                "What's most important: price, speed, quality, or terms?"
            ],
            justification: [
                "Help me understand your constraints",
                "What would make this a win for you?",
                "What metrics matter most to your organization?",
                "Who else needs to approve this?",
                "What's your biggest concern?"
            ],
            benefits: [
                "Beyond price, what would add value for you?",
                "Would faster delivery help?",
                "Do you value flexibility or certainty more?",
                "What support services matter?",
                "Long-term partnership or one-time deal?"
            ],
            tradeoffs: [
                "If we could improve X, would you be flexible on Y?",
                "What could we add that would justify a higher price?",
                "What could we remove to lower cost?",
                "Volume discount for longer commitment?"
            ]
        };
    }

    /**
     * Analyze opponent's message for information
     */
    extractInformation(message) {
        const info = {
            needsRevealed: [],
            constraintsRevealed: [],
            valuationsRevealed: [],
            timelineHints: [],
            justifications: []
        };

        const lower = message.toLowerCase();

        // Extract needs
        if (lower.includes('need') || lower.includes('require')) {
            info.needsRevealed.push(this._extractNeed(message));
        }

        // Extract constraints
        if (lower.includes('can\'t') || lower.includes('limited') || lower.includes('budget')) {
            info.constraintsRevealed.push(this._extractConstraint(message));
        }

        // Extract timeline
        if (lower.includes('urgent') || lower.includes('asap') || lower.match(/\d+\s+(day|week|month)/)) {
            info.timelineHints.push(this._extractTimeline(message));
        }

        // Extract justification (the "why")
        if (lower.includes('because') || lower.includes('since') || lower.includes('reason')) {
            info.justifications.push(this._extractJustification(message));
        }

        // Extract valuation (what they care about)
        const valuationKeywords = ['important', 'critical', 'priority', 'value', 'matter'];
        for (const keyword of valuationKeywords) {
            if (lower.includes(keyword)) {
                info.valuationsRevealed.push(this._extractValuation(message, keyword));
            }
        }

        return info;
    }

    /**
     * Determine what question to ask next
     */
    getNextQuestion(conversationHistory) {
        // Phase progression: discovery → justification → benefits → tradeoffs
        
        if (this.discoveredInfo.theirNeeds.length < 2) {
            // Still in discovery - understand the problem
            return {
                phase: 'discovery',
                question: this._selectQuestion('discovery', conversationHistory),
                reasoning: 'Need to understand their core problem first'
            };
        }

        if (this.discoveredInfo.theirJustifiers.length < 2) {
            // Need to understand WHY
            return {
                phase: 'justification',
                question: this._selectQuestion('justification', conversationHistory),
                reasoning: 'Need to understand their motivations and constraints'
            };
        }

        if (this.discoveredInfo.theirBenefits.size < 3) {
            // Map their value priorities
            return {
                phase: 'benefits',
                question: this._selectQuestion('benefits', conversationHistory),
                reasoning: 'Need to discover what they value beyond price'
            };
        }

        // Now we can explore creative trade-offs
        return {
            phase: 'tradeoffs',
            question: this._selectQuestion('tradeoffs', conversationHistory),
            reasoning: 'Identify value-creating trade-offs'
        };
    }

    /**
     * Generate creative solution options (integrative bargaining)
     */
    generateCreativeOptions(myBenefits, theirBenefits) {
        const options = [];

        // Find complementary benefits (what I value that they don't, and vice versa)
        for (const [myItem, myValue] of myBenefits) {
            const theirValue = theirBenefits.get(myItem) || 0;
            
            if (myValue > theirValue) {
                // I value this more - I should get it
                options.push({
                    item: myItem,
                    strategy: 'claim',
                    rationale: `I value ${myItem} more (${myValue} vs ${theirValue})`
                });
            } else if (theirValue > myValue) {
                // They value this more - trade for something else
                options.push({
                    item: myItem,
                    strategy: 'concede_for_tradeoff',
                    rationale: `Trade ${myItem} (low value to me) for higher-value item`
                });
            }
        }

        // Package deals
        if (options.some(o => o.strategy === 'concede_for_tradeoff')) {
            options.push({
                item: 'package_deal',
                strategy: 'bundle',
                rationale: 'Bundle low-value concessions with high-value requests'
            });
        }

        return options;
    }

    /**
     * Calculate ZOPA (Zone of Possible Agreement) across multiple issues
     */
    calculateMultiIssueZOPA() {
        const issues = ['price', 'timeline', 'payment_terms', 'support', 'exclusivity'];
        const zopa = {};

        for (const issue of issues) {
            const myRange = this.discoveredInfo.ourBenefits.get(issue);
            const theirRange = this.discoveredInfo.theirBenefits.get(issue);

            if (myRange && theirRange) {
                const overlap = this._findOverlap(myRange, theirRange);
                if (overlap) {
                    zopa[issue] = overlap;
                }
            }
        }

        return zopa;
    }

    /**
     * Assess information completeness
     */
    assessInformationGaps() {
        const gaps = [];

        if (this.discoveredInfo.theirNeeds.length === 0) {
            gaps.push({ type: 'critical', gap: 'Unknown what problem they\'re solving' });
        }

        if (this.discoveredInfo.theirJustifiers.length === 0) {
            gaps.push({ type: 'high', gap: 'Unknown their motivation/rationale' });
        }

        if (this.discoveredInfo.theirBenefits.size < 3) {
            gaps.push({ type: 'medium', gap: 'Need to discover what they value beyond price' });
        }

        if (!this.discoveredInfo.theirTimeline) {
            gaps.push({ type: 'medium', gap: 'Unknown urgency/timeline' });
        }

        return gaps;
    }

    /**
     * Strategic advice based on discovered information
     */
    getStrategicAdvice() {
        const gaps = this.assessInformationGaps();
        const advice = [];

        if (gaps.length > 0) {
            advice.push({
                priority: 'high',
                action: 'ASK_QUESTIONS',
                reason: 'Missing critical information',
                questions: gaps.map(g => this.getNextQuestion([]).question)
            });
        }

        // Check for creative options
        const creativeOptions = this.generateCreativeOptions(
            this.discoveredInfo.ourBenefits,
            this.discoveredInfo.theirBenefits
        );

        if (creativeOptions.length > 0) {
            advice.push({
                priority: 'medium',
                action: 'PROPOSE_PACKAGE',
                reason: 'Identified value-creating trade-offs',
                options: creativeOptions
            });
        }

        // Check for shared interests
        if (this.discoveredInfo.sharedInterests.length > 0) {
            advice.push({
                priority: 'high',
                action: 'EMPHASIZE_SHARED_GOALS',
                reason: 'Common interests can expand the pie',
                interests: this.discoveredInfo.sharedInterests
            });
        }

        return advice;
    }

    // Helper methods
    _extractNeed(message) {
        // Extract what they need (simple version, can be enhanced with NLP)
        const needMatch = message.match(/need\s+(?:to\s+)?([^,.]+)/i);
        return needMatch ? needMatch[1].trim() : 'Unspecified need';
    }

    _extractConstraint(message) {
        const constraintMatch = message.match(/(?:can't|limited|budget)\s+([^,.]+)/i);
        return constraintMatch ? constraintMatch[1].trim() : 'Unspecified constraint';
    }

    _extractTimeline(message) {
        const timeMatch = message.match(/(\d+)\s+(day|week|month|year)s?/i);
        if (timeMatch) {
            const value = parseInt(timeMatch[1]);
            const unit = timeMatch[2].toLowerCase();
            return { value, unit, urgency: value < 7 && unit === 'day' ? 'high' : 'medium' };
        }
        if (message.toLowerCase().includes('urgent') || message.toLowerCase().includes('asap')) {
            return { urgency: 'high', reason: 'Explicit urgency stated' };
        }
        return null;
    }

    _extractJustification(message) {
        const justMatch = message.match(/(?:because|since|reason)\s+([^,.]+)/i);
        return justMatch ? justMatch[1].trim() : 'Unspecified reason';
    }

    _extractValuation(message, keyword) {
        const context = message.match(new RegExp(`${keyword}\\s+(?:is\\s+)?([^,.]+)`, 'i'));
        return context ? { item: context[1].trim(), priority: 'high' } : null;
    }

    _selectQuestion(phase, history) {
        const questions = this.questionStrategy[phase];
        // Avoid repeating questions
        const askedQuestions = history.filter(h => h.type === 'question').map(h => h.question);
        const unasked = questions.filter(q => !askedQuestions.includes(q));
        return unasked[0] || questions[0];
    }

    _findOverlap(rangeA, rangeB) {
        const start = Math.max(rangeA.min, rangeB.min);
        const end = Math.min(rangeA.max, rangeB.max);
        return start <= end ? { min: start, max: end } : null;
    }
}

export { IntegrativeNegotiationEngine };

