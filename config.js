import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config = {
  API_KEYS: [
        process.env.GEMINI_API_KEY,
        process.env.GEMINI_API_KEY_1,
        process.env.GEMINI_API_KEY_2, // Add a second key in your .env file
    ],
	//API_KEY=process.env.GEMINI_API_KEY,
  ORCHESTRATOR_URL: 'http://127.0.0.1:5000',
  GEMINI_MODEL: 'gemini-1.5-flash'
};

export default config;
