import { GoogleGenerativeAI } from "@google/generative-ai";
import { unifiedAgentPrompt, mediatedClarificationPrompt, doctorAgentPrompt } from './prompts.js';
import config from './config.js';

const genAI = new GoogleGenerativeAI(config.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function processUserMessage(userId, message) {
    try {
        const prompt = unifiedAgentPrompt
            .replace('{{userId}}', userId)
            .replace('{{message}}', message);
        
        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Error in unified agent processing:", error);
        // Return a safe, default response
        return {
            reply: "I'm having some trouble processing that. Could you please rephrase?",
            privacyLevel: 'PRIVATE',
            criticality: 'LOW',
            facts: {}
        };
    }
}

async function generateDoctorAgentReply(type, details) {
    try {
        const prompt = doctorAgentPrompt
            .replace('{{type}}', type)
            .replace('{{details}}', details);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return `[Escalation] ${response.text().trim()}`;
    } catch (error) {
        console.error("Error generating doctor reply:", error);
        return "[Escalation] A critical event occurred, but the summary failed to generate. Please review logs.";
    }
}

async function generateMediatedClarification(targetUser, factKey) {
     try {
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


export { processUserMessage, generateMediatedClarification, generateDoctorAgentReply };

