/**
 * @fileoverview agents/index.js
 * The public interface for the agents module.
 */

import { processUserMessage, performContextEnrichment } from './unifiedAgent.js';
import { generateDoctorSummary, generateDelegatedProbe } from './doctorAgent.js';
import {
    classifyUserIntent,
    classifyExplicitIntent, // NEW
    generateSharingRequest,
    generateMediatedClarification,
    analyzeRelationship,
    generateSharingSummaryOrProbe,
    generateCaregiverProbe,
    generatePatientProbeFromCaregiver
} from './utilityAgents.js';
import { matchResponseToAction } from './stateAgent.js';

export {
    processUserMessage,
    performContextEnrichment,
    generateDoctorSummary,
    generateDelegatedProbe,
    classifyUserIntent,
    classifyExplicitIntent, // NEW
    generateSharingRequest,
    generateMediatedClarification,
    analyzeRelationship,
    generateSharingSummaryOrProbe,
    generateCaregiverProbe,
    generatePatientProbeFromCaregiver,
    matchResponseToAction
};

