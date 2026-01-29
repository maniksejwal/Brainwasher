/**
 * @fileoverview Shared utilities for API providers
 */

/**
 * Makes a POST request to a JSON endpoint with standard error handling.
 * @param {string} url - The URL to call.
 * @param {object} body - The JSON body to send.
 * @param {object} [options] - Optional settings.
 * @param {string} [options.apiKey] - API Key if required.
 * @param {string} [options.apiKeyHeader] - Header name for API Key (default: 'x-api-key').
 * @param {object} [options.headers] - Additional headers.
 * @returns {Promise<any>} - Examples: The parsed JSON response.
 * @throws {Error} - If response is not OK.
 */
export async function postJson(url, body, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (options.apiKey) {
        const headerName = options.apiKeyHeader || 'x-api-key';
        headers[headerName] = options.apiKey;
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            const error = new Error(`Request failed (${response.status}): ${text || response.statusText}`);
            error.status = response.status;
            throw error;
        }

        return await response.json();
    } catch (error) {
        // Enhance error message if it's a network error (fetch failed)
        if (error.message.includes('fetch failed')) {
            error.message = `Network error calling ${url}: ${error.message}`;
        }
        throw error;
    }
}
