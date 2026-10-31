/**
 * @fileoverview shared/session.js
 * Holds the session token from login and attaches it to API requests.
 * Works in both Node.js (CLI) and the browser (GUI).
 */

let sessionToken = null;

export function setSessionToken(token) {
    sessionToken = token || null;
}

export function getSessionToken() {
    return sessionToken;
}

/**
 * fetch with the session token in the Authorization header.
 * @param {string} url
 * @param {RequestInit} [options]
 */
export function authFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
    return fetch(url, { ...options, headers });
}

/**
 * Add the session token to a stream URL. EventSource cannot send headers, so stream
 * routes also accept the token as a query parameter.
 * @param {string} url
 */
export function withSessionToken(url) {
    if (!sessionToken) return url;
    return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(sessionToken)}`;
}
