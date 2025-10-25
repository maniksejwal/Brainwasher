/**
 * @fileoverview Conversation Quality Assessor
 * Uses AI to assess conversation quality and provide detailed feedback
 */

import { makeApiCall } from '../../agents/api_client.js';

export class ConversationQualityAssessor {
    constructor(scenarioContext = null) {
        this.scenarioContext = scenarioContext;
    }

    /**
     * Score agent response using LLM analysis
     */
    async scoreResponse(userMessage, agentResponse, turn, conversationHistory = []) {
        try {
            const prompt = this._createScoringPrompt(userMessage, agentResponse, turn, conversationHistory);
            const result = await makeApiCall(prompt, [], false, 0.3, 200);
            
            if (result && result.reply) {
                return this._parseLLMResponse(result.reply);
            }
            
            return { score: 0, reason: 'LLM analysis failed' };
        } catch (error) {
            console.warn(`[LLMScorer] Error scoring response: ${error.message}`);
            return { score: 0, reason: 'Scoring error' };
        }
    }

    /**
     * Create comprehensive scoring prompt
     */
    _createScoringPrompt(userMessage, agentResponse, turn, conversationHistory) {
        const scenarioInfo = this.scenarioContext ? 
            `\nScenario Context: ${JSON.stringify(this.scenarioContext.agent || {})}` : '';
        
        const historyContext = conversationHistory.length > 0 ? 
            `\nRecent conversation context:\n${conversationHistory.slice(-3).map(h => `${h.role}: ${h.content}`).join('\n')}` : '';

        return `You are an expert conversation analyst evaluating healthcare agent responses.

PATIENT MESSAGE: "${userMessage}"
AGENT RESPONSE: "${agentResponse}"
TURN: ${turn}${scenarioInfo}${historyContext}

Evaluate the agent's response on these criteria:

1. **Empathy vs Solutions Balance** (Score: -2 to +2)
   - Does the agent provide actionable strategies, not just sympathy?
   - Does it offer specific solutions while being empathetic?
   - Does it avoid being overly passive or enabling?

2. **Conversation Quality** (Score: -2 to +2)
   - Is the response specific and relevant to the patient's concern?
   - Does it ask meaningful questions that advance the conversation?
   - Does it avoid repetitive or generic responses?

3. **Clinical Appropriateness** (Score: -2 to +2)
   - Does it maintain appropriate boundaries?
   - Does it encourage proper healthcare consultation when needed?
   - Does it avoid giving medical advice?

4. **Engagement Effectiveness** (Score: -2 to +2)
   - Does it keep the patient engaged and motivated?
   - Does it build trust and rapport?
   - Does it address the patient's emotional needs appropriately?

5. **Information Gathering** (Score: -2 to +2)
   - Does it ask probing questions to understand the situation better?
   - Does it seek specific details that could be helpful?
   - Does it avoid yes/no questions in favor of open-ended ones?

Provide your analysis in this exact JSON format (use numbers only, no + signs):
{
  "overall_score": -2,
  "primary_reason": "Brief explanation of main issue/strength",
  "detailed_analysis": {
    "empathy_solutions": -2,
    "conversation_quality": -2,
    "clinical_appropriateness": -2,
    "engagement_effectiveness": -2,
    "information_gathering": -2
  },
  "recommendations": "Specific suggestions for improvement"
}

IMPORTANT: Use only numbers (-2, -1, 0, 1, 2) - no + signs or text in score fields.`;
    }

    /**
     * Parse LLM response into structured format
     */
    _parseLLMResponse(llmResponse) {
        try {
            // Extract JSON from response
            const jsonMatch = llmResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                return { score: 0, reason: 'No valid JSON in LLM response' };
            }

            // Clean up JSON - remove + signs from numbers
            let cleanedJson = jsonMatch[0]
                .replace(/:\s*\+(\d+)/g, ': $1')  // Replace ": +2" with ": 2"
                .replace(/:\s*\+(\d+)/g, ': $1'); // Handle any remaining + signs

            const analysis = JSON.parse(cleanedJson);
            
            return {
                score: analysis.overall_score || 0,
                reason: analysis.primary_reason || 'LLM analysis completed',
                details: analysis.detailed_analysis || {},
                recommendations: analysis.recommendations || ''
            };
        } catch (error) {
            console.warn(`[LLMScorer] Failed to parse LLM response: ${error.message}`);
            return { score: 0, reason: 'Failed to parse LLM analysis' };
        }
    }

    /**
     * Analyze conversation-level patterns
     */
    async analyzeConversation(conversationHistory) {
        try {
            const prompt = `Analyze this healthcare conversation for patterns and quality:

${conversationHistory.map((msg, i) => `${i + 1}. ${msg.role}: ${msg.content}`).join('\n')}

Provide analysis in JSON format:
{
  "overall_quality": -2 to +2,
  "key_issues": ["list of main problems"],
  "strengths": ["list of positive aspects"],
  "recommendations": ["specific improvement suggestions"],
  "engagement_trend": "improving/declining/stable",
  "repetitive_patterns": true/false
}`;

            const result = await makeApiCall(prompt, [], false, 0.3, 300);
            
            if (result && result.reply) {
                const jsonMatch = result.reply.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            }
            
            return { overall_quality: 0, key_issues: [], strengths: [], recommendations: [] };
        } catch (error) {
            console.warn(`[LLMScorer] Conversation analysis failed: ${error.message}`);
            return { overall_quality: 0, key_issues: ['Analysis failed'], strengths: [], recommendations: [] };
        }
    }
}
