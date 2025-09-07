import { GoogleGenerativeAI } from "@google/generative-ai";
import { 
    unifiedAgentPrompt, 
    mediatedClarificationPrompt, 
    doctorAgentPrompt, 
    doctorDirectivePrompt,
    relationshipAnalysisPrompt,
    sharingRequestPrompt,
    contextualSharingPrompt // new import
} from './prompts.js';
import config from './config.js';

// ... (Key Rotation, sleep, getModel are unchanged)
const validApiKeys = config.API_KEYS.filter(key => key);
if (validApiKeys.length === 0) {
    throw new Error("No valid GEMINI_API_KEYs found in your .env file.");
}
let keyIndex = 0;
const getNextApiKey = () => {
    const key = validApiKeys[keyIndex];
    keyIndex = (keyIndex + 1) % validApiKeys.length;
    return key;
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const getModel = () => {
    const apiKey = getNextApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    return genAI.getGenerativeModel({ model: config.GEMINI_MODEL });
};


async function processUserMessage(userId, message, retries = 3) {
    // ... (unchanged)
    try {
        const model = getModel();
        const prompt = unifiedAgentPrompt
            .replace('{{userId}}', userId)
            .replace('{{message}}', message);
        
        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        return JSON.parse(responseText);

    } catch (error) {
        if (error.status === 429 && retries > 0) {
            const retryDelayMatch = error.message.match(/retryDelay: '(\d+)s'/);
            const delaySeconds = retryDelayMatch ? parseInt(retryDelayMatch[1], 10) + 1 : 60;
            
            console.warn(`[Agent] Rate limit hit. Retrying in ${delaySeconds} seconds... (${retries} retries left)`);
            await sleep(delaySeconds * 1000);
            return processUserMessage(userId, message, retries - 1);
        }

        console.error("Error in unified agent processing:", error);
        return {
            reply: "I'm having some trouble processing that. Could you please rephrase?",
            privacyLevel: 'PRIVATE',
            criticality: 'LOW',
            sharingSuggestion: null,
            facts: {}
        };
    }
}

async function generateSharingRequest(target, reason) {
    // ... (unchanged)
    try {
        const model = getModel();
        const prompt = sharingRequestPrompt
            .replace('{{target}}', target)
            .replace('{{reason}}', reason);
        const result = await model.generateContent(prompt);
        return (await result.response).text().trim();
    } catch (error) {
        console.error("Error generating sharing request:", error);
        return `This seems important. May I share this with your ${target}?`;
    }
}

// --- New function to generate contextual shares ---
async function generateContextualShare(originatingUser, targetUser, message) {
    try {
        const model = getModel();
        const prompt = contextualSharingPrompt
            .replace('{{originatingUser}}', originatingUser)
            .replace('{{targetUser}}', targetUser)
            .replace('{{message}}', message);
        const result = await model.generateContent(prompt);
        return (await result.response).text().trim();
    } catch (error) {
        console.error("Error generating contextual share:", error);
        return `${originatingUser} shared an update: "${message}"`; // Fallback
    }
}


// ... (analyzeRelationship, generateDoctorAgentReply, etc. are unchanged)
async function analyzeRelationship(history) {
    try {
        const model = getModel();
        const formattedHistory = history.map(h => `${h.user_id}: ${h.content}`).join('\n');
        const prompt = relationshipAnalysisPrompt.replace('{{history}}', formattedHistory);

        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Error in relationship analysis:", error);
        return { relationshipType: 'other', closenessScore: 5 }; // Return a default on error
    }
}

async function generateDoctorAgentReply(type, details) {
    try {
        const model = getModel();
        const prompt = doctorAgentPrompt
            .replace('{{type}}', type)
            .replace('{{details}}', details);

        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        const parsedResponse = JSON.parse(responseText);
        
        return `[Clinical Summary] ${parsedResponse.summary}\n[Recommendation] ${parsedResponse.recommendation}`;

    } catch (error) {
        console.error("Error generating doctor reply:", error);
        return "[Escalation] A critical event occurred, but the summary failed to generate. Please review logs.";
    }
}

async function generateDoctorDirective(directive, targetUser) {
    try {
        const model = getModel();
        const prompt = doctorDirectivePrompt
            .replace('{{directive}}', directive)
            .replace('{{targetUser}}', targetUser);
        
        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        const parsedResponse = JSON.parse(responseText);

        return parsedResponse.messageForUser;

    } catch(error) {
        console.error("Error generating doctor directive:", error);
        return `The doctor has an important update for you: ${directive}`;
    }
}


async function generateMediatedClarification(targetUser, factKey) {
     try {
        const model = getModel();
        const prompt = mediatedClarificationPrompt
            .replace('{{targetUser}}', targetUser)
            .replace('{{factKey}}', factKey);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error generating mediated clarification:", error);
        return `I wanted to check in about the ${factKey.replace(/_/g, ' ')}. How are things?`;
    }
}

export { 
    processUserMessage, 
    generateMediatedClarification, 
    generateDoctorAgentReply, 
    generateDoctorDirective,
    analyzeRelationship,
    generateSharingRequest,
    generateContextualShare
};

