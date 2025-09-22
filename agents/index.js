/**
 * @fileoverview This file serves as the public interface for the agents module.
 * It imports all the agent functions from their specialized files and re-exports
 * them, so other modules can import all agent functions from a single place.
 */

import { processUserMessage, performContextEnrichment } from './unifiedAgent.js';
import { generateDoctorSummary, generateDelegatedProbe } from './doctorAgent.js';
import {
    classifyUserIntent,
    generateSharingRequest,
    generateMediatedClarification,
    analyzeRelationship,
    generateSharingSummaryOrProbe
} from './utilityAgents.js';
import { matchResponseToAction } from './stateAgent.js';

export {
    processUserMessage,
    performContextEnrichment, // NEW
    generateDoctorSummary,
    generateDelegatedProbe,
    classifyUserIntent,
    generateSharingRequest,
    generateMediatedClarification,
    analyzeRelationship,
    generateSharingSummaryOrProbe,
    matchResponseToAction
};

