import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config = {
  API_KEY: process.env.GEMINI_API_KEY,
  ORCHESTRATOR_URL: 'http://127.0.0.1:5000',
};

export default config;
