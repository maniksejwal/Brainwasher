import dotenv from 'dotenv';
dotenv.config();

const config = {
    GEMINI_API_KEYS: [process.env.GEMINI_API_KEY_0, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2].filter(Boolean),
	CHAT_GPT_KEY: process.env.CHAT_GPT_KEY,
	
    // Model Configuration - Simple and Clear
    OPENAI_MODEL: 'gpt-3.5-turbo',                    // Free tier - DEFAULT
    OPENAI_MODEL_GPT4: 'gpt-4',                      // Paid
    OPENAI_MODEL_GPT4_TURBO: 'gpt-4-turbo-preview',  // Paid
    OPENAI_MODEL_GPT4O: 'gpt-4o',                    // Paid
    OPENAI_MODEL_GPT4O_MINI: 'gpt-4o-mini',          // Paid (cheaper)
    OPENAI_MODEL_GPT5: 'gpt-5',                      // Paid (future)
    
    // Google Models
    GEMINI_MODEL: 'gemini-1.5-flash-latest',         // Free tier
    GEMINI_MODEL_PRO: 'gemini-pro',                  // Free tier
    GEMINI_MODEL_FLASH: 'gemini-1.5-flash',          // Free tier
    GEMINI_MODEL_PRO_VISION: 'gemini-pro-vision',    // Free tier
    
    // HARDCODED PREFERENCES - Free Tier Only
    USE_FREE_TIER_ONLY: true,                         // Set to false to use paid models
    DEFAULT_MODEL: 'gpt-3.5-turbo',                  // What to use when free tier only
    FALLBACK_MODEL: 'gpt-3.5-turbo',                // Fallback when primary fails
    
    // Simple Model Selection - Just Lists
    FREE_MODELS: ['gpt-3.5-turbo', 'gemini-1.5-flash-latest', 'gemini-pro'],
    PAID_MODELS: ['gpt-4', 'gpt-4-turbo-preview', 'gpt-4o', 'gpt-4o-mini', 'gpt-5'],
    
    // Use Case Mapping - Simple Constants
    BASIC_RESPONSES_MODEL: 'gpt-3.5-turbo',
    CONVERSATIONAL_AGENT_MODEL: 'gpt-3.5-turbo',      // Changed to free tier
    ESCALATION_MODEL: 'gpt-3.5-turbo',               // Changed to free tier
    CRITICAL_ANALYSIS_MODEL: 'gpt-3.5-turbo',        // Changed to free tier
    SYNTHETIC_USER_MODEL: 'gpt-3.5-turbo',
    
    // Memory Configuration
    MAX_SESSION_MEMORY: 20,
    MAX_CONVERSATION_HISTORY: 50,
    
    // Load Balancer - Simple Settings
    USE_LOAD_BALANCER: true,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    USE_ONLY_OPENAI: true,                           // Skip Gemini due to reliability issues
    
    // Companion System Configuration
    USE_COMPANIONS: true,                            // Use Companion system (false = use unified agent)
    COMPANION_AB_TEST_ENABLED: true,                // A/B test Companion vs unified agent
    COMPANION_AB_TEST_RATIO: 0.5,                    // 50% Companion, 50% unified (when enabled)

    HOST: '127.0.0.1',
    PORT: 5000,
};

// Construct the URL from HOST and PORT
config.ORCHESTRATOR_URL = `http://${config.HOST}:${config.PORT}`;

export default config;

