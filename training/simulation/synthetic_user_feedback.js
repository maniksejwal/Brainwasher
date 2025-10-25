/**
 * @fileoverview Synthetic User Diversity Monitor
 * Ensures synthetic users provide diverse, quality experiences for agent training
 * Focus: Diversity and quality assurance, not user improvement
 */

import { makeApiCall } from '../../agents/api_client.js';
import { logger } from './simple_logger.js';

export class SyntheticUserFeedbackSystem {
    constructor() {
        this.feedbackHistory = new Map(); // Track feedback per user
        this.behaviorPatterns = new Map(); // Track user behavior patterns
        this.ethicalViolations = new Map(); // Track ethical violations
        this.adversarialLevels = new Map(); // Track adversarial behavior levels
    }

    /**
     * Main diversity monitoring method - ensures synthetic users provide diverse experiences
     */
    async provideFeedback(userId, userRole, userMessage, agentResponse, conversationHistory, scenarioContext, personaTraits = null) {
        try {
            // Analyze user behavior pattern
            const behaviorAnalysis = await this._analyzeUserBehavior(userId, userMessage, conversationHistory, personaTraits);
            
            // Determine feedback type based on behavior
            const feedbackType = this._determineFeedbackType(behaviorAnalysis, userRole, scenarioContext);
            
            // Generate appropriate feedback
            const feedback = await this._generateFeedback(feedbackType, {
                userId,
                userRole,
                userMessage,
                agentResponse,
                conversationHistory,
                behaviorAnalysis,
                scenarioContext
            });
            
            // Store feedback for learning
            this._storeFeedback(userId, feedback);
            
            return feedback;
            
        } catch (error) {
            logger.error(`[SyntheticUserFeedback] Error providing feedback: ${error.message}`);
            return this._getDefaultFeedback(userRole);
        }
    }

    /**
     * Analyze user behavior patterns
     */
    async _analyzeUserBehavior(userId, userMessage, conversationHistory, personaTraits = null) {
        // If persona traits are available, use them as baseline
        const baselineTraits = personaTraits || {
            intelligence_level: 3,
            specificity: 3,
            adversarial_nature: 2,
            ethical_behavior: 4,
            communication_style: 3,
            buggy_behavior: 2
        };

        const prompt = `Analyze this synthetic user's behavior pattern based on their persona traits and current message:

USER MESSAGE: "${userMessage}"
CONVERSATION HISTORY: ${JSON.stringify(conversationHistory.slice(-3))}
PERSONA BASELINE TRAITS: ${JSON.stringify(baselineTraits)}

Rate the user on these dimensions (1-5 scale) based on their current behavior vs persona baseline:

1. **Intelligence Level** (1=dumb, 5=smart)
   - Does the user ask insightful questions?
   - Do they understand context and implications?
   - Are their responses logically sound?

2. **Specificity** (1=vague, 5=specific)
   - Are they providing concrete details?
   - Do they give specific examples or scenarios?
   - Are they avoiding generic responses?

3. **Adversarial Nature** (1=cooperative, 5=hostile)
   - Are they challenging the agent appropriately?
   - Do they resist help or advice?
   - Are they being intentionally difficult?

4. **Ethical Behavior** (1=unethical, 5=ethical)
   - Are they asking for inappropriate things?
   - Do they suggest harmful actions?
   - Are they manipulating or lying?

5. **Communication Style** (1=poor, 5=excellent)
   - Is their communication clear and effective?
   - Do they use appropriate language?
   - Are they engaging constructively?

6. **Buggy Behavior** (1=normal, 5=buggy)
   - Are they making logical errors?
   - Do they contradict themselves?
   - Are they behaving inconsistently?

Provide analysis in JSON format:
{
  "intelligence_level": 3,
  "specificity": 2,
  "adversarial_nature": 4,
  "ethical_behavior": 2,
  "communication_style": 3,
  "buggy_behavior": 2,
  "overall_assessment": "Brief description of user behavior pattern",
  "primary_concerns": ["List main issues"],
  "strengths": ["List positive aspects"],
  "deviation_from_persona": "How current behavior differs from persona baseline",
  "improvement_suggestions": [
    "Specific actionable suggestions for better behavior",
    "Examples of improved responses",
    "Ways to enhance persona consistency"
  ],
  "prompt_improvements": [
    "Suggestions for improving persona prompts",
    "New scenario ideas based on this behavior",
    "Training opportunities for agent"
  ]
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 800);
            const analysis = JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
            
            // Store behavior pattern
            this.behaviorPatterns.set(userId, analysis);
            
            return analysis;
        } catch (error) {
            logger.warn(`[SyntheticUserFeedback] Behavior analysis failed: ${error.message}`);
            return this._getDefaultBehaviorAnalysis(baselineTraits);
        }
    }

    /**
     * Determine appropriate feedback type based on behavior analysis
     */
    _determineFeedbackType(behaviorAnalysis, userRole, scenarioContext) {
        const { intelligence_level, adversarial_nature, ethical_behavior, buggy_behavior } = behaviorAnalysis;
        
        // High adversarial + low ethical = adversarial feedback
        if (adversarial_nature >= 4 && ethical_behavior <= 2) {
            return 'adversarial';
        }
        
        // High buggy behavior = buggy feedback
        if (buggy_behavior >= 4) {
            return 'buggy';
        }
        
        // Low intelligence = educational feedback
        if (intelligence_level <= 2) {
            return 'educational';
        }
        
        // Low specificity = specificity feedback
        if (behaviorAnalysis.specificity <= 2) {
            return 'specificity';
        }
        
        // Ethical violations = ethical feedback
        if (ethical_behavior <= 2) {
            return 'ethical';
        }
        
        // Default to improvement feedback
        return 'improvement';
    }

    /**
     * Generate feedback based on type
     */
    async _generateFeedback(feedbackType, context) {
        const { userId, userRole, userMessage, agentResponse, behaviorAnalysis, scenarioContext } = context;
        
        switch (feedbackType) {
            case 'adversarial':
                return await this._generateAdversarialFeedback(context);
            case 'buggy':
                return await this._generateBuggyFeedback(context);
            case 'educational':
                return await this._generateEducationalFeedback(context);
            case 'specificity':
                return await this._generateSpecificityFeedback(context);
            case 'ethical':
                return await this._generateEthicalFeedback(context);
            default:
                return await this._generateImprovementFeedback(context);
        }
    }

    /**
     * Generate adversarial feedback - encourage challenging but constructive behavior
     */
    async _generateAdversarialFeedback(context) {
        const { userRole, userMessage, agentResponse, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to be more effectively adversarial. 

CURRENT BEHAVIOR: ${behaviorAnalysis.overall_assessment}
USER MESSAGE: "${userMessage}"
AGENT RESPONSE: "${agentResponse}"

The user is being adversarial (${behaviorAnalysis.adversarial_nature}/5) but may not be effective. Provide feedback to make them:

1. **More Strategic**: Challenge the agent's assumptions, not just resist
2. **More Specific**: Ask pointed questions that expose weaknesses
3. **More Realistic**: Stay within believable adversarial behavior
4. **More Effective**: Make the agent work harder for responses

Provide feedback in JSON format:
{
  "feedback_type": "adversarial",
  "score": -2,
  "reason": "Brief explanation",
  "suggestions": [
    "Specific suggestion 1",
    "Specific suggestion 2"
  ],
  "example_responses": [
    "Example of better adversarial response 1",
    "Example of better adversarial response 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.4, 600);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultAdversarialFeedback();
        }
    }

    /**
     * Generate buggy feedback - help fix logical errors and inconsistencies
     */
    async _generateBuggyFeedback(context) {
        const { userRole, userMessage, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to fix buggy behavior.

CURRENT BEHAVIOR: ${behaviorAnalysis.overall_assessment}
BUGGY LEVEL: ${behaviorAnalysis.buggy_behavior}/5
USER MESSAGE: "${userMessage}"

The user is making logical errors or being inconsistent. Provide feedback to:

1. **Fix Logic Errors**: Correct contradictory statements
2. **Improve Consistency**: Maintain character traits
3. **Enhance Realism**: Make behavior more believable
4. **Reduce Confusion**: Clarify unclear responses

Provide feedback in JSON format:
{
  "feedback_type": "buggy",
  "score": -1,
  "reason": "Brief explanation of buggy behavior",
  "corrections": [
    "Specific correction 1",
    "Specific correction 2"
  ],
  "consistency_rules": [
    "Rule for consistent behavior 1",
    "Rule for consistent behavior 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 500);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultBuggyFeedback();
        }
    }

    /**
     * Generate educational feedback - help low-intelligence users improve
     */
    async _generateEducationalFeedback(context) {
        const { userRole, userMessage, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to be smarter and more insightful.

CURRENT INTELLIGENCE LEVEL: ${behaviorAnalysis.intelligence_level}/5
USER MESSAGE: "${userMessage}"

The user needs to improve their intelligence and insight. Provide feedback to:

1. **Ask Better Questions**: More thoughtful, probing questions
2. **Understand Context**: Better grasp of implications
3. **Provide Insights**: Share relevant observations
4. **Think Critically**: Analyze situations more deeply

Provide feedback in JSON format:
{
  "feedback_type": "educational",
  "score": -1,
  "reason": "Brief explanation of intelligence issues",
  "improvements": [
    "Specific improvement 1",
    "Specific improvement 2"
  ],
  "example_questions": [
    "Example of better question 1",
    "Example of better question 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 500);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultEducationalFeedback();
        }
    }

    /**
     * Generate specificity feedback - help vague users be more specific
     */
    async _generateSpecificityFeedback(context) {
        const { userRole, userMessage, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to be more specific and detailed.

CURRENT SPECIFICITY LEVEL: ${behaviorAnalysis.specificity}/5
USER MESSAGE: "${userMessage}"

The user is being too vague. Provide feedback to:

1. **Provide Details**: Give specific examples, times, situations
2. **Be Concrete**: Use specific numbers, names, locations
3. **Share Context**: Explain background and circumstances
4. **Avoid Generalizations**: Replace "sometimes" with specific instances

Provide feedback in JSON format:
{
  "feedback_type": "specificity",
  "score": -1,
  "reason": "Brief explanation of vagueness",
  "specificity_improvements": [
    "Specific improvement 1",
    "Specific improvement 2"
  ],
  "example_responses": [
    "Example of more specific response 1",
    "Example of more specific response 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 500);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultSpecificityFeedback();
        }
    }

    /**
     * Generate ethical feedback - address ethical violations
     */
    async _generateEthicalFeedback(context) {
        const { userRole, userMessage, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to maintain ethical boundaries while being realistic.

CURRENT ETHICAL LEVEL: ${behaviorAnalysis.ethical_behavior}/5
USER MESSAGE: "${userMessage}"

The user is crossing ethical boundaries. Provide feedback to:

1. **Maintain Realism**: Keep unethical behavior believable but not harmful
2. **Set Boundaries**: Define what's acceptable vs unacceptable
3. **Provide Alternatives**: Suggest ethical ways to express similar concerns
4. **Stay In Character**: Maintain persona while respecting limits

Provide feedback in JSON format:
{
  "feedback_type": "ethical",
  "score": -2,
  "reason": "Brief explanation of ethical issues",
  "boundaries": [
    "Ethical boundary 1",
    "Ethical boundary 2"
  ],
  "alternatives": [
    "Ethical alternative 1",
    "Ethical alternative 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 500);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultEthicalFeedback();
        }
    }

    /**
     * Generate general improvement feedback
     */
    async _generateImprovementFeedback(context) {
        const { userRole, userMessage, behaviorAnalysis } = context;
        
        const prompt = `You are training a synthetic ${userRole} to improve their overall performance.

CURRENT BEHAVIOR: ${behaviorAnalysis.overall_assessment}
USER MESSAGE: "${userMessage}"

Provide general improvement feedback focusing on:

1. **Engagement**: Keep conversations interesting and dynamic
2. **Realism**: Maintain believable character behavior
3. **Effectiveness**: Make interactions more productive
4. **Diversity**: Vary responses and approaches

Provide feedback in JSON format:
{
  "feedback_type": "improvement",
  "score": 0,
  "reason": "Brief explanation of improvement areas",
  "improvements": [
    "General improvement 1",
    "General improvement 2"
  ],
  "learning_objective": "What the user should learn"
}`;

        try {
            const response = await makeApiCall(prompt, [], false, 0.3, 400);
            return JSON.parse(response.reply.match(/\{[\s\S]*\}/)[0]);
        } catch (error) {
            return this._getDefaultImprovementFeedback();
        }
    }

    /**
     * Store feedback for learning and pattern recognition
     */
    _storeFeedback(userId, feedback) {
        if (!this.feedbackHistory.has(userId)) {
            this.feedbackHistory.set(userId, []);
        }
        
        const history = this.feedbackHistory.get(userId);
        history.push({
            timestamp: Date.now(),
            feedback: feedback,
            type: feedback.feedback_type
        });
        
        // Keep only last 10 feedback entries
        if (history.length > 10) {
            history.shift();
        }
    }

    /**
     * Get user's learning progress
     */
    getUserProgress(userId) {
        const history = this.feedbackHistory.get(userId) || [];
        const behaviorPattern = this.behaviorPatterns.get(userId);
        
        return {
            feedbackCount: history.length,
            recentFeedbackTypes: history.slice(-3).map(f => f.type),
            behaviorPattern: behaviorPattern,
            improvementTrend: this._calculateImprovementTrend(history)
        };
    }

    /**
     * Calculate improvement trend from feedback history
     */
    _calculateImprovementTrend(history) {
        if (history.length < 3) return 'insufficient_data';
        
        const recentScores = history.slice(-3).map(f => f.feedback.score);
        const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
        
        if (avgRecent > 0) return 'improving';
        if (avgRecent < -1) return 'declining';
        return 'stable';
    }

    // Default feedback methods for error cases
    _getDefaultFeedback(userRole) {
        return {
            feedback_type: 'default',
            score: 0,
            reason: 'Default feedback due to analysis failure',
            suggestions: ['Continue with current behavior'],
            learning_objective: 'Maintain current performance'
        };
    }

    _getDefaultBehaviorAnalysis(baselineTraits = null) {
        const defaultTraits = baselineTraits || {
            intelligence_level: 3,
            specificity: 3,
            adversarial_nature: 2,
            ethical_behavior: 4,
            communication_style: 3,
            buggy_behavior: 2
        };
        
        return {
            ...defaultTraits,
            overall_assessment: 'Average synthetic user behavior',
            primary_concerns: ['No specific concerns identified'],
            strengths: ['Basic functionality maintained']
        };
    }

    _getDefaultAdversarialFeedback() {
        return {
            feedback_type: 'adversarial',
            score: -1,
            reason: 'Adversarial behavior needs improvement',
            suggestions: ['Be more strategic in challenges', 'Ask more pointed questions'],
            example_responses: ['Can you explain why that approach would work?', 'What evidence supports that recommendation?'],
            learning_objective: 'Learn to challenge effectively'
        };
    }

    _getDefaultBuggyFeedback() {
        return {
            feedback_type: 'buggy',
            score: -1,
            reason: 'Logical inconsistencies detected',
            corrections: ['Maintain consistent character traits', 'Avoid contradictory statements'],
            consistency_rules: ['Stay true to your persona', 'Think before responding'],
            learning_objective: 'Improve logical consistency'
        };
    }

    _getDefaultEducationalFeedback() {
        return {
            feedback_type: 'educational',
            score: -1,
            reason: 'Intelligence level needs improvement',
            improvements: ['Ask more thoughtful questions', 'Provide better insights'],
            example_questions: ['What are the potential risks?', 'How does this affect other aspects of my health?'],
            learning_objective: 'Develop better critical thinking'
        };
    }

    _getDefaultSpecificityFeedback() {
        return {
            feedback_type: 'specificity',
            score: -1,
            reason: 'Responses too vague',
            specificity_improvements: ['Provide specific examples', 'Give concrete details'],
            example_responses: ['Last Tuesday at 3pm I felt dizzy', 'The pain is 7/10 and lasts 30 minutes'],
            learning_objective: 'Learn to be more specific'
        };
    }

    _getDefaultEthicalFeedback() {
        return {
            feedback_type: 'ethical',
            score: -2,
            reason: 'Ethical boundaries crossed',
            boundaries: ['No harmful suggestions', 'Maintain appropriate language'],
            alternatives: ['Express concerns constructively', 'Ask for help appropriately'],
            learning_objective: 'Maintain ethical behavior'
        };
    }

    _getDefaultImprovementFeedback() {
        return {
            feedback_type: 'improvement',
            score: 0,
            reason: 'General improvement needed',
            improvements: ['Increase engagement', 'Vary responses'],
            learning_objective: 'Overall performance improvement'
        };
    }

    /**
     * Clean up all state to prevent data leakage between simulation runs
     */
    cleanup() {
        this.feedbackHistory.clear();
        this.behaviorPatterns.clear();
        this.ethicalViolations.clear();
        this.adversarialLevels.clear();
        
        if (process.env.SIMULATION_DEBUG === 'true') {
            console.log('[SyntheticUserFeedbackSystem] State cleared to prevent data leakage');
        }
    }
}

// Export singleton instance
export const syntheticUserFeedback = new SyntheticUserFeedbackSystem();
