/**
 * @fileoverview companions/physio/tensornetsBridge.js
 * Optional link to the Python tensornets server. Nothing is requested unless TENSORNETS_URL is set.
 */
const TIMEOUT_MS = 3000;

/**
 * A short summary of the subject's earlier sessions, from the Python server.
 * @param {string} subjectId - Subject user ID
 * @returns {Promise<string>} The hint, or '' if the server is not set up, slow or unavailable
 */
export async function getLongitudinalHint(subjectId) {
    const baseUrl = process.env.TENSORNETS_URL;
    if (!baseUrl) return '';
    try {
        const response = await fetch(`${baseUrl}/therapy/prompt-hint/${encodeURIComponent(subjectId)}`, {
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        if (!response.ok) return '';
        const data = await response.json();
        return data?.hint ?? '';
    } catch {
        return '';
    }
}
