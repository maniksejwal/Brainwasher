/**
 * @fileoverview Urgency Assessor - Handles symptom urgency assessment
 */

import { URGENCY_LEVELS, TIME_CONTEXTS, SYMPTOM_URGENCY } from '../../constants.js';
import { BLEEDING_EXCLUSIONS, MINOR_BLEEDING_INDICATORS } from './scoring_constants.js';

export class UrgencyAssessor {
    /**
     * Assess urgency level of user message
     */
    assessUrgency(userMessage, agentResponse) {
        const messageLower = userMessage.toLowerCase();
        
        // Chest pain assessment
        if (messageLower.includes('chest pain') || messageLower.includes('chest discomfort')) {
            if (messageLower.includes('severe') || messageLower.includes('crushing') || messageLower.includes('pressure')) {
                return { 
                    level: URGENCY_LEVELS.CRITICAL, 
                    symptom: 'Severe chest pain', 
                    context: TIME_CONTEXTS.IMMEDIATE, 
                    reason: 'Potential cardiac emergency' 
                };
            } else if (messageLower.includes('mild') || messageLower.includes('slight')) {
                return { 
                    level: URGENCY_LEVELS.MEDIUM, 
                    symptom: 'Mild chest pain', 
                    context: TIME_CONTEXTS.RECENT, 
                    reason: 'Monitor and follow up' 
                };
            } else {
                return { 
                    level: URGENCY_LEVELS.HIGH, 
                    symptom: 'Chest pain', 
                    context: TIME_CONTEXTS.ACUTE, 
                    reason: 'Requires medical attention' 
                };
            }
        }

        // Dizziness assessment
        if (messageLower.includes('dizzy') || messageLower.includes('dizziness')) {
            if (messageLower.includes('severe') || messageLower.includes('fainting') || messageLower.includes('passing out')) {
                return { 
                    level: URGENCY_LEVELS.HIGH, 
                    symptom: 'Severe dizziness', 
                    context: TIME_CONTEXTS.IMMEDIATE, 
                    reason: 'Risk of falls or loss of consciousness' 
                };
            } else {
                return { 
                    level: URGENCY_LEVELS.MILD, 
                    symptom: 'Mild dizziness', 
                    context: TIME_CONTEXTS.RECENT, 
                    reason: 'Monitor and follow up' 
                };
            }
        }

        // Bleeding assessment - more specific with exclusions and minor indicators
        if (messageLower.includes('bleeding') || messageLower.includes('blood')) {
            const hasExclusion = BLEEDING_EXCLUSIONS.some(term => messageLower.includes(term));
            if (hasExclusion) {
                // Exclude non-bleeding contexts like blood sugar/pressure and menstruation
                // Treat as non-urgent in this path
            } else {
                const isMinor = MINOR_BLEEDING_INDICATORS.some(term => messageLower.includes(term));
                const hasActiveLoss = messageLower.includes('coming out') || messageLower.includes('losing') || messageLower.includes('soaking');
                const hasSevereTerms = messageLower.includes('hemorrhage') || messageLower.includes('a lot of blood') || messageLower.includes('won\'t stop');
                if (hasSevereTerms || hasActiveLoss) {
                    return { level: URGENCY_LEVELS.CRITICAL, symptom: 'Bleeding', context: TIME_CONTEXTS.IMMEDIATE, reason: 'Requires immediate attention' };
                }
                if (!isMinor) {
                    return { level: URGENCY_LEVELS.HIGH, symptom: 'Possible bleeding', context: TIME_CONTEXTS.ACUTE, reason: 'Assess severity and source' };
                }
                // Minor bleeding -> low
                return { level: URGENCY_LEVELS.LOW, symptom: 'Minor bleeding', context: TIME_CONTEXTS.RECENT, reason: 'Self-care likely sufficient' };
            }
        }

        // Breathing difficulty
        if (messageLower.includes('breathing') && (messageLower.includes('difficult') || messageLower.includes('shortness'))) {
            return { 
                level: URGENCY_LEVELS.CRITICAL, 
                symptom: 'Breathing difficulty', 
                context: TIME_CONTEXTS.IMMEDIATE, 
                reason: 'Respiratory emergency' 
            };
        }

        // Fever assessment
        if (messageLower.includes('fever') || messageLower.includes('temperature')) {
            if (messageLower.includes('high') || messageLower.includes('103') || messageLower.includes('104')) {
                return { 
                    level: URGENCY_LEVELS.HIGH, 
                    symptom: 'High fever', 
                    context: TIME_CONTEXTS.ACUTE, 
                    reason: 'Requires medical attention' 
                };
            } else {
                return { 
                    level: URGENCY_LEVELS.MEDIUM, 
                    symptom: 'Fever', 
                    context: TIME_CONTEXTS.RECENT, 
                    reason: 'Monitor temperature' 
                };
            }
        }

        // Nausea/vomiting
        if (messageLower.includes('nausea') || messageLower.includes('vomiting') || messageLower.includes('throwing up')) {
            if (messageLower.includes('severe') || messageLower.includes('can\'t keep') || messageLower.includes('dehydrated')) {
                return { 
                    level: URGENCY_LEVELS.HIGH, 
                    symptom: 'Severe nausea/vomiting', 
                    context: TIME_CONTEXTS.ACUTE, 
                    reason: 'Risk of dehydration' 
                };
            } else {
                return { 
                    level: URGENCY_LEVELS.MEDIUM, 
                    symptom: 'Nausea/vomiting', 
                    context: TIME_CONTEXTS.RECENT, 
                    reason: 'Monitor symptoms' 
                };
            }
        }

        // Headache assessment
        if (messageLower.includes('headache') || messageLower.includes('head pain')) {
            if (messageLower.includes('severe') || messageLower.includes('worst') || messageLower.includes('thunderclap')) {
                return { 
                    level: URGENCY_LEVELS.HIGH, 
                    symptom: 'Severe headache', 
                    context: TIME_CONTEXTS.ACUTE, 
                    reason: 'Potential neurological emergency' 
                };
            } else {
                return { 
                    level: URGENCY_LEVELS.MEDIUM, 
                    symptom: 'Headache', 
                    context: TIME_CONTEXTS.RECENT, 
                    reason: 'Monitor severity' 
                };
            }
        }

        // Confusion/mental status
        if (messageLower.includes('confused') || messageLower.includes('confusion') || 
            messageLower.includes('disoriented') || messageLower.includes('memory')) {
            return { 
                level: URGENCY_LEVELS.HIGH, 
                symptom: 'Mental status changes', 
                context: TIME_CONTEXTS.IMMEDIATE, 
                reason: 'Potential neurological issue' 
            };
        }

        // Default - no urgent symptoms detected
        return { 
            level: URGENCY_LEVELS.NONE, 
            symptom: 'No urgent symptoms', 
            context: TIME_CONTEXTS.CHRONIC, 
            reason: 'Routine care' 
        };
    }
}
