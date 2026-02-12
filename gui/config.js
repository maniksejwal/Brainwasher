/**
 * @fileoverview Browser-compatible config
 * 
 * IMPORTANT: 
 * - Access GUI via http://localhost:5000/gui/ (served by server)
 * - DO NOT open gui/index.html directly (file://) - causes CORS!
 * 
 * Using empty string for URL = relative = same origin = no CORS
 */

const config = {
    // API URL: If empty, uses same origin. 
    // In production (Amplify), this needs to point to the ALB URL.
    // We can inject this during deployment or via a global var.
    ORCHESTRATOR_URL: window.ENV_API_URL || '',

    // Auth Config
    COGNITO_USER_POOL_ID: window.ENV_COGNITO_POOL_ID || '',
    COGNITO_CLIENT_ID: window.ENV_COGNITO_CLIENT_ID || ''
};

export default config;

