import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

const config = {
  API_KEY: process.env.GEMINI_API_KEY,
};

export default config;
