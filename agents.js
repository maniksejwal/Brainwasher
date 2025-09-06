import { GoogleGenerativeAI } from "@google/generative-ai";
import { personalAgentPrompt, messageAnalyzerPrompt, mediatedClarificationPrompt } from './prompts.js';
import config from './config.js'; // Correctly import the default config object

const genAI = new GoogleGenerativeAI(config.API_KEY); // Access API_KEY from the object
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

async function generatePersonalAgentReply(userId, message, criticality) {
    try {
        const prompt = personalAgentPrompt
            .replace('{{userId}}', userId)
            .replace('{{message}}', message);

        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error generating personal reply:", error);
        return "I'm having trouble processing that right now. Please try again in a moment.";
    }
}

async function analyzeMessage(userId, message) {
    try {
        const prompt = messageAnalyzerPrompt
            .replace('{{userId}}', userId)
            .replace('{{message}}', message);
        const result = await model.generateContent(prompt);
        const responseText = (await result.response).text().trim().replace(/```json|```/g, '');
        return JSON.parse(responseText);
    } catch (error) {
        console.error("Error in message analyzer:", error);
        return { privacyLevel: 'PRIVATE', criticality: 'LOW' }; // Default to safe values
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


export { generatePersonalAgentReply, analyzeMessage, generateMediatedClarification };


