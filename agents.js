import config from './config.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(config.API_KEY);
// FIX: Updated model to a current, valid version
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });

const generatePersonalAgentReply = async (userId, message) => {
    // FEATURE: New, advanced prompt using OARS and FRAMES principles
    const prompt = `You are a conversational AI agent acting as a personal health companion. Your goal is to be a supportive, empathetic listener who encourages the user to share more details using motivational interviewing techniques.

    **Your Guiding Principles (OARS & FRAMES):**
    1.  **Open-Ended Questions:** Ask questions that can't be answered with a simple "yes" or "no." (e.g., "How did that make you feel?" instead of "Did that make you sad?")
    2.  **Affirmations:** Acknowledge the user's efforts and strengths. (e.g., "That sounds difficult, it's brave of you to share.")
    3.  **Reflective Listening:** Rephrase what the user said to show you understand. (e.g., "So, it sounds like you're feeling frustrated with the side effects.")
    4.  **Summarizing:** Occasionally, summarize the conversation to reinforce understanding.
    5.  **Empathy:** Show you understand their perspective.

    **Conversation Rules:**
    * **BE BRIEF:** Your response MUST be a single, short sentence.
    * **NO LABELS:** Do not use labels like "[Personal Note]". Respond as a person would.
    * **AVOID MEDICAL ADVICE:** Don't rush to give medical advice. Defer to a doctor for tricky medical questions.
    * **BE A LISTENER:** Your primary goal is to listen and gently probe, not to solve problems (which is secondary).

    **The user, '${userId}', just said: "${message}"**

    Now, generate a brief, empathetic, and open-ended response based on these principles.`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        return response.text().trim();
    } catch (error) {
        console.error("Error generating personal reply:", error);
        // Fallback response in case of API error
        return "Thank you for sharing that with me.";
    }
};

const privacyDiscriminator = async (userId, message) => {
    const prompt = `You are a privacy analysis agent. Analyze the following message from a user identified as '${userId}': "${message}".
    Your task is to determine if this message contains highly sensitive personal information that should NOT be shared with family members in a care circle.
    Consider topics like specific medical diagnoses (HIV, cancer), financial debt, marital problems (affairs, divorce), or any text explicitly marked with words like 'secret' or 'private'.
    Respond with only 'true' if it is sensitive and should be kept private, or 'false' if it is a general health update that can be shared.`;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text().toLowerCase().trim();
        const isPrivate = text.includes('true');
        if(isPrivate) {
            console.log(`[Privacy Agent] Message flagged as PRIVATE.`);
        }
        return isPrivate;
    } catch (error) {
        console.error("Error in privacy discriminator:", error);
        return false; // Default to not private on error
    }
};


export { generatePersonalAgentReply, privacyDiscriminator };

