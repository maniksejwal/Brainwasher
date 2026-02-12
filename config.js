import dotenv from 'dotenv';
dotenv.config();

function sanitizeString(value, defaultValue = '') {
    if (typeof value !== 'string') return defaultValue;
    const trimmed = value.trim();
    if (!trimmed) return defaultValue;
    return trimmed.replace(/^['"]+/, '').replace(/['"]+$/, '');
}

function toBoolean(value, defaultValue = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return defaultValue;
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    return defaultValue;
}

const DEFAULT_MODEL_FALLBACK = 'gpt-3.5-turbo';

const envConfig = {
    OLLAMA_API_BASE_URL: sanitizeString(process.env.OLLAMA_API_BASE_URL, process.env.OLLAMA_API_BASE_URL || ''),
    OLLAMA_DEFAULT_MODEL: sanitizeString(process.env.OLLAMA_DEFAULT_MODEL, process.env.OLLAMA_DEFAULT_MODEL || ''),
    DEFAULT_MODEL: sanitizeString(process.env.DEFAULT_MODEL, DEFAULT_MODEL_FALLBACK),
    FALLBACK_MODEL: sanitizeString(process.env.FALLBACK_MODEL, DEFAULT_MODEL_FALLBACK),
    BASIC_RESPONSES_MODEL: sanitizeString(process.env.BASIC_RESPONSES_MODEL, DEFAULT_MODEL_FALLBACK),
    CONVERSATIONAL_AGENT_MODEL: sanitizeString(process.env.CONVERSATIONAL_AGENT_MODEL, DEFAULT_MODEL_FALLBACK),
    ESCALATION_MODEL: sanitizeString(process.env.ESCALATION_MODEL, DEFAULT_MODEL_FALLBACK),
    CRITICAL_ANALYSIS_MODEL: sanitizeString(process.env.CRITICAL_ANALYSIS_MODEL, DEFAULT_MODEL_FALLBACK),
    SYNTHETIC_USER_MODEL: sanitizeString(process.env.SYNTHETIC_USER_MODEL, DEFAULT_MODEL_FALLBACK),
    USE_ONLY_OPENAI: toBoolean(process.env.USE_ONLY_OPENAI, false),
};

const config = {
    GEMINI_API_KEYS: [process.env.GEMINI_API_KEY_0, process.env.GEMINI_API_KEY, process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2].filter(Boolean),
    CHAT_GPT_KEY: process.env.CHAT_GPT_KEY,
    OLLAMA_API_BASE_URL: envConfig.OLLAMA_API_BASE_URL,
    OLLAMA_DEFAULT_MODEL: envConfig.OLLAMA_DEFAULT_MODEL,

    // Model Configuration - Simple and Clear
    OPENAI_MODEL: 'gpt-3.5-turbo',                    // Free tier - DEFAULT
    OPENAI_MODEL_GPT4: 'gpt-4',                      // Paid
    OPENAI_MODEL_GPT4_TURBO: 'gpt-4-turbo-preview',  // Paid
    OPENAI_MODEL_GPT4O: 'gpt-4o',                    // Paid
    OPENAI_MODEL_GPT4O_MINI: 'gpt-4o-mini',          // Paid (cheaper)
    OPENAI_MODEL_GPT5: 'gpt-5',                      // Paid (future)

    // Google Models
    GEMINI_MODEL: 'gemini-pro',                      // Verified working model for v1
    GEMINI_MODEL_PRO: 'gemini-pro',                  // Free tier
    GEMINI_MODEL_FLASH: 'gemini-1.5-flash',          // Free tier
    GEMINI_MODEL_PRO_VISION: 'gemini-pro-vision',    // Free tier

    // GLOBAL OVERRIDES
    USE_LLAMA_FOR_ALL: true,                         // Set to true to force Llama 4 for ALL agents
    USE_FREE_TIER_ONLY: false,                       // Set to false to use paid models
    DEFAULT_MODEL: envConfig.DEFAULT_MODEL,                  // What to use when free tier only
    FALLBACK_MODEL: envConfig.FALLBACK_MODEL,                // Fallback when primary fails

    // Simple Model Selection - Just Lists
    FREE_MODELS: ['mistral:latest', 'gpt-3.5-turbo', 'gemini-1.5-flash-latest', 'gemini-pro'],
    PAID_MODELS: ['gpt-4', 'gpt-4-turbo-preview', 'gpt-4o', 'gpt-4o-mini', 'gpt-5'],

    // Use Case Mapping - Simple Constants
    BASIC_RESPONSES_MODEL: envConfig.BASIC_RESPONSES_MODEL,
    CONVERSATIONAL_AGENT_MODEL: envConfig.CONVERSATIONAL_AGENT_MODEL,      // Changed to free tier
    ESCALATION_MODEL: envConfig.ESCALATION_MODEL,               // Changed to free tier
    CRITICAL_ANALYSIS_MODEL: envConfig.CRITICAL_ANALYSIS_MODEL,        // Changed to free tier
    SYNTHETIC_USER_MODEL: envConfig.SYNTHETIC_USER_MODEL,

    // Memory Configuration
    MAX_SESSION_MEMORY: 20,
    MAX_CONVERSATION_HISTORY: 50,

    // Load Balancer - Simple Settings
    USE_LOAD_BALANCER: false,
    MAX_RETRIES: 3,
    RETRY_DELAY: 1000,
    USE_ONLY_OPENAI: envConfig.USE_ONLY_OPENAI,                           // Skip Gemini due to reliability issues

    // Companion System Configuration
    USE_COMPANIONS: true,                            // Use Companion system (false = use unified agent)
    COMPANION_AB_TEST_ENABLED: true,                // A/B test Companion vs unified agent
    COMPANION_AB_TEST_RATIO: 0.5,                    // 50% Companion, 50% unified (when enabled)

    HOST: '127.0.0.1',
    PORT: 5000,

    // Database Configuration
    NODE_ENV: process.env.NODE_ENV || 'development',
    DB_PATHS: {
        production: process.env.DB_PATH_PRODUCTION || './data/dbs/care_circle_prod.db',
        development: process.env.DB_PATH_DEVELOPMENT || './data/dbs/care_circle_dev.db',
        simulation: process.env.DB_PATH_SIMULATION || './data/dbs/care_circle_simulation.db',
        test: process.env.DB_PATH_TEST || ':memory:'
    },

    // Get active database path based on environment
    getDbPath(mode = null) {
        // 1. Explicit override
        if (process.env.DB_PATH) return process.env.DB_PATH;

        // 2. Simulation mode (legacy support)
        if (process.env.SIMULATION_MODE === 'true') {
            return this.DB_PATHS.simulation;
        }

        // 3. Mode-specific (e.g., for tests)
        if (mode) return this.DB_PATHS[mode] || this.DB_PATHS.development;

        // 4. Environment-based
        return this.DB_PATHS[this.NODE_ENV] || this.DB_PATHS.development;
    },

    // Storage Configuration
    STORAGE_TYPE: process.env.STORAGE_TYPE || 'local', // 'local', 's3', 'gcp'
    STORAGE_LOCAL_PATH: process.env.STORAGE_LOCAL_PATH || './data/storage/local',

    // S3 Storage (future)
    STORAGE_S3_BUCKET: process.env.STORAGE_S3_BUCKET || '',
    STORAGE_S3_REGION: process.env.STORAGE_S3_REGION || 'us-east-1',

    // GCP Storage (future)
    STORAGE_GCP_BUCKET: process.env.STORAGE_GCP_BUCKET || '',
    STORAGE_GCP_PROJECT_ID: process.env.STORAGE_GCP_PROJECT_ID || '',

    // External APIs
    LLAMA_API_URL: process.env.LLAMA_API_URL || 'https://5p99qnahlb.execute-api.ap-south-1.amazonaws.com/api/llama/generate',
    LLAMA_API_KEY: process.env.LLAMA_API_KEY || '',

    // ICD API
    ICD_API_URL: process.env.ICD_API_URL || '',
    ICD_API_KEY: process.env.ICD_API_KEY || '',

    // Cognito
    COGNITO_USER_POOL_ID: process.env.COGNITO_USER_POOL_ID || '',
    COGNITO_CLIENT_ID: process.env.COGNITO_CLIENT_ID || ''
};

// Construct the URL from HOST and PORT
config.ORCHESTRATOR_URL = `http://${config.HOST}:${config.PORT}`;

export default config;


