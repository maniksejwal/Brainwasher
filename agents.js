import config from './config.js';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { personalAgentPrompt, messageAnalyzerPrompt } from './prompts.js';

const genAI = new GoogleGenerativeAI(config.API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const generatePersonalAgentReply = async (userId, message) => {
    // FEATURE: Prompt is now imported from prompts.js
    const prompt = personalAgentPrompt
        .replace('{{userId}}', userId)
        .replace('{{message}}', message);

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error generating personal reply:", error);
        return "Thank you for sharing that with me.";
    }
};

// FEATURE: Replaced the simple privacyDiscriminator with a sophisticated message analyzer
const analyzeMessage = async (userId, message) => {
    const prompt = messageAnalyzerPrompt
        .replace('{{userId}}', userId)
        .replace('{{message}}', message);

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text().match(/```json\n([\s\S]*?)\n```/)[1];
        const analysis = JSON.parse(jsonText);
        return analysis;
    } catch (error) {
        console.error("Error in message analyzer:", error);
        // Fallback to the safest possible classification on error
        return { privacyLevel: 'SENSITIVE', criticality: 'LOW' };
    }
};


export { generatePersonalAgentReply, analyzeMessage };

