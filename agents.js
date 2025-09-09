import { GoogleGenerativeAI } from '@google/generative-ai';
import config from './config.js';
import {
    PROMPT_UNIFIED_AGENT_WITH_STATE as PROMPT_UNIFIED_AGENT,
    PROMPT_SHARING_REQUEST,
    PROMPT_MEDIATED_CLARIFICATION,
    PROMPT_RELATIONSHIP_ANALYSIS,
    PROMPT_SHARING_SUMMARY
} from './prompts.js';
import { getRecentMessages, getUserState, getFactHistory } from './database.js';
// FIX: Use named imports for the behavioral models, which now correctly matches the export style.
import { STAGES_OF_CHANGE, COPING_STYLES } from './behavioral_models.js';


let genAIs = [];

if (config.API_KEYS && config.API_KEYS.length > 0) {
    genAIs = config.API_KEYS.map(apiKey => {
        if (!apiKey) return null;
        try {
            return new GoogleGenerativeAI(apiKey).getGenerativeModel({ model: config.GEMINI_MODEL });
        } catch (error) {
            console.error('[Agent] Error initializing a Gemini client. Is the API key valid?', error.message);
            return null;
        }
    }).filter(Boolean);
}

if (genAIs.length === 0) {
    console.error("\n[Agent] FATAL ERROR: No valid Gemini API keys found or initialized.");
    console.error("Please check your .env file and ensure GEMINI_API_KEY_1 (and optionally GEMINI_API_KEY_2) are set correctly.\n");
}


let keyIndex = 0;
function getNextClient() {
    if (genAIs.length === 0) return null;
    const client = genAIs[keyIndex];
    keyIndex = (keyIndex + 1) % genAIs.length;
    return client;
}

async function makeApiCall(prompt, history = []) {
    const model = getNextClient();
    if (!model) {
         return {
            reply: "The AI service is not configured. Please check the server logs.",
            privacyLevel: 'PRIVATE',
            criticality: 'NONE',
            facts: {},
            sharingSuggestion: null
        };
    }

    const fullPrompt = `${history.join('\n')}\n\n${prompt}`;
    
    const maxRetries = 3;
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const result = await model.generateContent(fullPrompt);
            const response = await result.response;
            let text = response.text();
            
            const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
            if (jsonMatch && jsonMatch[1]) {
                return JSON.parse(jsonMatch[1]);
            }
            return { reply: text };

        } catch (error) {
            lastError = error;
            if (error.status === 503 || error.status === 429) {
                const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
                console.warn(`[Agent] API call failed with status ${error.status}. Retrying in ${Math.round(delay/1000)}s... (Attempt ${attempt}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                break;
            }
        }
    }

    console.error("[Agent] Error calling Gemini API after all retries:", lastError);
    return {
        reply: "I'm having some trouble processing that right now. Could you please rephrase?",
        privacyLevel: 'PRIVATE',
        criticality: 'LOW',
        facts: {},
        sharingSuggestion: null
    };
}

export async function processUserMessage(userId, role, message) {
    const history = await getRecentMessages(userId, 5);
    const historyText = history.map(h => `${h.user_id}: ${h.message}`);
    const currentState = await getUserState(userId);
    const factHistory = await getFactHistory('all', 10);

    const behavioralModels = {
        stages_of_change: STAGES_OF_CHANGE,
        coping_styles: COPING_STYLES
    };

    const prompt = PROMPT_UNIFIED_AGENT
        .replace('{{ROLE}}', role)
        .replace('{{MESSAGE}}', message)
        .replace('{{USER_STATE}}', JSON.stringify(currentState, null, 2))
        .replace('{{FACT_HISTORY}}', JSON.stringify(factHistory, null, 2))
        .replace('{{BEHAVIORAL_MODELS}}', JSON.stringify(behavioralModels, null, 2));

    return makeApiCall(prompt, historyText);
}

export async function generateSharingRequest(target, reason) {
    const prompt = PROMPT_SHARING_REQUEST
        .replace('{{TARGET}}', target)
        .replace('{{REASON}}', reason);
    const result = await makeApiCall(prompt);
    return result.reply;
}

export async function generateMediatedClarification(targetUser, factKey) {
    const prompt = PROMPT_MEDIATED_CLARIFICATION
        .replace('{{TARGET_USER}}', targetUser)
        .replace('{{FACT_KEY}}', factKey);
    const result = await makeApiCall(prompt);
    return result.reply;
}

export async function analyzeRelationship(sharedHistory) {
    if (!sharedHistory || sharedHistory.length === 0) {
        return { relationshipType: 'unknown', closenessScore: 50 };
    }
    const prompt = PROMPT_RELATIONSHIP_ANALYSIS.replace('{{CONVERSATION_LOG}}', sharedHistory.join('\n'));
    return makeApiCall(prompt);
}

export async function generateSharingSummaryOrProbe(fromUser, toUser, message) {
    const prompt = PROMPT_SHARING_SUMMARY
        .replace('{{FROM_USER}}', fromUser)
        .replace('{{TO_USER}}', toUser)
        .replace('{{MESSAGE}}', message);
    const result = await makeApiCall(prompt);
    return result.reply;
}

