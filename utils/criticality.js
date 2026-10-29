/**
 * @fileoverview utils/criticality.js
 * Normalizes model-produced criticality values onto the canonical scale in
 * CRITICALITY_LEVELS (NONE < LOW < MEDIUM < HIGH). HIGH means "escalate now".
 */

import { CRITICALITY_LEVELS, CRITICALITY_ORDER } from '../constants.js';

// Synonyms models have produced (or plausibly produce) for each canonical level
const ALIASES = {
    HIGH: ['HIGH', 'CRITICAL', 'URGENT_INTERVENTION', 'URGENT', 'EMERGENCY', 'SEVERE'],
    MEDIUM: ['MEDIUM', 'MODERATE'],
    LOW: ['LOW', 'MILD', 'MINOR'],
    NONE: ['NONE', 'NO', 'N/A', 'NA']
};

const ALIAS_MAP = Object.fromEntries(
    Object.entries(ALIASES).flatMap(([level, names]) => names.map(name => [name, level]))
);

/**
 * Map a raw criticality value to a canonical level.
 * Pipe-separated values (a model echoing the template, e.g. "LOW|HIGH") resolve to the highest.
 * @param {*} value - Raw value from a model or upstream component
 * @param {string} fallback - Returned when the value is missing or unrecognized
 * @returns {string} One of CRITICALITY_LEVELS
 */
export function normalizeCriticality(value, fallback = CRITICALITY_LEVELS.NONE) {
    const levels = String(value ?? '')
        .split('|')
        .map(part => ALIAS_MAP[part.trim().toUpperCase().replace(/[\s-]+/g, '_')])
        .filter(Boolean);

    if (levels.length === 0) {
        return ALIAS_MAP[String(fallback).toUpperCase()] || CRITICALITY_LEVELS.NONE;
    }
    return levels.reduce((a, b) => (CRITICALITY_ORDER[b] > CRITICALITY_ORDER[a] ? b : a));
}
