import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// --- Initialization ---
dotenv.config();

// Configure the Gemini API client
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY not found. Please set it in your .env file.");
}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });


/**
 * --- Core IP: Personal Agent Reply Generator ---
 * Generates an empathetic, supportive reply to a user's message.
 * @param {string} user - The role of the user ('patient' or 'caregiver').
 * @param {string} message - The user's message.
 * @returns {Promise<string>} The generated reply from the personal agent.
 */
export async function generatePersonalAgentReply(user, message) {
    console.log(`\n[Personal Agent] Generating reply for ${user}...`);
    const prompt = `You are an empathetic AI personal agent in a healthcare context. Your user, a ${user}, just sent you the following message.

    User's Message: "${message}"

    Your task is to provide a brief, supportive, and non-prescriptive reply. Acknowledge their message and offer encouragement. Do NOT give medical advice. Keep your response to one or two sentences.

    Example 1:
    User Message: "I took my medicine this morning."
    Your Reply: "That's great to hear! Keeping on track is a big step."

    Example 2:
    User Message: "He did not take his medicine today."
    Your Reply: "Thank you for letting me know. It's helpful to understand the challenges."
    
    Example 3:
    User Message: "I have been feeling very depressed about my secret financial debt."
    Your Reply: "It sounds like you're going through a lot, and I'm here to listen. Thank you for sharing that with me."`;
    
    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const reply = response.text().trim();
        console.log(`[Personal Agent] Generated reply: "${reply}"`);
        return `[personal-agent says]: ${reply}`;
    } catch (e) {
        console.error("[Personal Agent] Error generating reply:", e);
        return "[personal-agent says]: Thank you for sharing that with me."; // Fallback reply
    }
}


/**
 * --- Core IP: Privacy Discriminator Agent ---
 * Analyzes a message to determine if it contains sensitive, private information.
 * @param {string} user - The role of the user sending the message.
 * @param {string} message - The message content.
 * @returns {Promise<boolean>} True if the message is deemed private, false otherwise.
 */
export async function privacyDiscriminator(user, message) {
  console.log(`\n[Privacy Discriminator] Analyzing message from ${user}: '${message}'`);
  const prompt = `
    Analyze the following message from a user in a healthcare context.
    The user is either a 'patient' or a 'caregiver'.
    Does the message contain sensitive, private information that the user might not want shared widely?
    Examples of sensitive information include confessions of non-compliance, mentions of secret financial or emotional issues, or anything explicitly stated as a secret.

    Message: "${message}"

    Answer with a single word: YES or NO.
    `;
  try {
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const answer = response.text().trim().toUpperCase();
    if (answer.includes("YES")) {
      console.log(`[Privacy Discriminator] *** PRIVACY ALERT *** Message from ${user} flagged as sensitive.`);
      return true;
    } else {
      console.log(`[Privacy Discriminator] Message from ${user} deemed safe to share.`);
      return false;
    }
  } catch (e) {
    console.error("[Privacy Discriminator] Error during API call:", e);
    return true; // Fail safe: assume it's private if the API fails.
  }
}
