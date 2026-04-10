/**
 * @fileoverview DEPRECATED - Domain Router functionality merged into contextAwareCompanionRouter.js
 * 
 * This file provided strict domain isolation between medical and business contexts.
 * The functionality has been integrated into contextAwareCompanionRouter.js with an 
 * isolationMode parameter for backward compatibility.
 * 
 * To use strict domain isolation (old domainRouter behavior):
 * import { routeMessage } from './contextAwareCompanionRouter.js';
 * await routeMessage(userId, circleId, message, true); // isolationMode = true
 * 
 * For smart unified context sharing (new default behavior):
 * await routeMessage(userId, circleId, message, false); // isolationMode = false
 */

export { routeMessage } from './contextAwareCompanionRouter.js';

console.warn('[DEPRECATED] domainRouter.js is deprecated. Use contextAwareCompanionRouter.js with isolationMode parameter.');