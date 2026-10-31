/**
 * @fileoverview lib/deliveryMode.js
 * How actions in a circle reach people.
 *
 * - local: this service sends them itself (in-app notifications and agent messages), for
 *   standalone use and simulations.
 * - healthymitra: the circle is a cache of a HealthyMitra CareCircle. Nothing is sent from
 *   here; every outward action is proposed, HealthyMitra executes the approved ones and
 *   reports the result (services/integrationActions.js).
 */

// Circles synced from HealthyMitra context snapshots (services/integrationService.js)
const HEALTHYMITRA_CIRCLE_PREFIX = 'hmc_';

/**
 * @param {string} circleId
 * @returns {'local'|'healthymitra'}
 */
export function deliveryModeFor(circleId) {
    return String(circleId ?? '').startsWith(HEALTHYMITRA_CIRCLE_PREFIX) ? 'healthymitra' : 'local';
}

export function isHealthyMitraCircle(circleId) {
    return deliveryModeFor(circleId) === 'healthymitra';
}
