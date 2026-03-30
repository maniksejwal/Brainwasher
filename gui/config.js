/**
 * @fileoverview Browser-compatible config
 *
 * IMPORTANT:
 * - Access GUI via http://localhost:5000/gui/ (served by server)
 * - DO NOT open gui/index.html directly (file://) - causes CORS!
 *
 * If no API base can be resolved, apiUrl() falls back to path-only URLs (same origin — e.g. local server).
 * Production GUI at research.easemymed.com defaults the API to https://api.research.easemymed.com when ENV_API_URL is missing.
 */

function normalizeBase(url) {
    if (!url || typeof url !== 'string') return '';
    return url.trim().replace(/\/$/, '');
}

/**
 * Prefer injected ENV_API_URL from env.js (Amplify build).
 * If missing (stale cache, misconfigured branch env), infer API host from the GUI hostname
 * so /api/* is never sent to the static site origin.
 */
function resolveOrchestratorBase() {
    const fromEnv = normalizeBase(typeof window !== 'undefined' ? (window.ENV_API_URL || '') : '');
    if (fromEnv) return fromEnv;

    if (typeof window !== 'undefined' && window.location?.hostname) {
        const h = window.location.hostname.toLowerCase();
        if (h === 'research.easemymed.com') {
            return 'https://api.research.easemymed.com';
        }
    }
    return '';
}

const base = resolveOrchestratorBase();

const config = {
    ORCHESTRATOR_URL: base,

    /** Absolute API URL for a path starting with / (e.g. /api/...). */
    apiUrl(path) {
        const p = path.startsWith('/') ? path : `/${path}`;
        if (!base) return p;
        return `${base}${p}`;
    },

    COGNITO_USER_POOL_ID: typeof window !== 'undefined' ? (window.ENV_COGNITO_POOL_ID || '') : '',
    COGNITO_CLIENT_ID: typeof window !== 'undefined' ? (window.ENV_COGNITO_CLIENT_ID || '') : ''
};

export default config;

