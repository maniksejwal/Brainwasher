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
    ORCHESTRATOR_URL: ''  // Empty = same origin as GUI (no CORS!)
};

export default config;

