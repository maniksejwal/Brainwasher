import dotenv from 'dotenv';
dotenv.config();

const config = {
    GEMINI_API_KEYS: [process.env.GEMINI_API_KEY_0, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2].filter(Boolean),
	CHAT_GPT_KEY: process.env.CHAT_GPT_KEY,
	
    GEMINI_MODEL: 'gemini-1.5-flash-latest',
    OPENAI_MODEL: 'gpt-3.5-turbo',

    HOST: '127.0.0.1',
    PORT: 5000,
};

// Construct the URL from HOST and PORT
config.ORCHESTRATOR_URL = `http://${config.HOST}:${config.PORT}`;

export default config;

