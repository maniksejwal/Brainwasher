/**
 * @fileoverview Constants for the Care Circle System
 * Centralized definitions for escalation levels, urgency, criticality, and privacy
 */

// Escalation Types (from orchestrator)
export const ESCALATION_TYPES = {
    CRITICAL: 'CRITICAL',
    CONFLICT: 'CONFLICT',
    MEDICAL: 'MEDICAL',
    PRIVACY: 'PRIVACY',
    CONSENT: 'CONSENT'
};

// Urgency Levels (for symptom assessment)
export const URGENCY_LEVELS = {
    CRITICAL: 'critical',    // Immediate medical attention needed
    HIGH: 'high',           // Urgent evaluation needed
    MEDIUM: 'medium',       // Follow-up needed
    LOW: 'low'              // Routine monitoring
};

// Criticality Levels (for messages)
export const CRITICALITY_LEVELS = {
    CRITICAL: 'CRITICAL',
    HIGH: 'HIGH', 
    MEDIUM: 'MEDIUM',
    LOW: 'LOW',
    NONE: 'NONE'
};

// Privacy Levels (for messages)
export const PRIVACY_LEVELS = {
    PRIVATE: 'PRIVATE',
    LIMITED: 'LIMITED', 
    PUBLIC: 'PUBLIC',
    NONE: 'NONE'
};

// Consent Levels (for circle members)
export const CONSENT_LEVELS = {
    FULL: 'FULL',
    LIMITED: 'LIMITED',
    NONE: 'NONE'
};

// User Roles
export const USER_ROLES = {
    PATIENT: 'patient',
    CAREGIVER: 'caregiver', 
    DOCTOR: 'doctor'
};

// Orchestrator Actions
export const ORCHESTRATOR_ACTIONS = {
    ESCALATE: 'ESCALATE',
    SHARE: 'SHARE',
    REQUEST_CLARIFICATION: 'REQUEST_CLARIFICATION',
    REQUEST_CONSENT: 'REQUEST_CONSENT',
    WAIT: 'WAIT',
    NONE: 'NONE'
};

// Symptom Urgency Mapping
export const SYMPTOM_URGENCY = {
    // Always critical
    BLEEDING: URGENCY_LEVELS.CRITICAL,
    UNCONSCIOUS: URGENCY_LEVELS.CRITICAL,
    BREATHING_DIFFICULTY: URGENCY_LEVELS.CRITICAL,
    
    // Context-dependent
    CHEST_PAIN: {
        SEVERE: URGENCY_LEVELS.CRITICAL,
        RECENT: URGENCY_LEVELS.HIGH,
        CHRONIC: URGENCY_LEVELS.LOW
    },
    
    DIZZINESS: {
        SEVERE: URGENCY_LEVELS.HIGH,
        MEDICATION_RELATED: URGENCY_LEVELS.MEDIUM,
        MILD: URGENCY_LEVELS.LOW
    },
    
    MENINGITIS_SYMPTOMS: {
        SEVERE: URGENCY_LEVELS.CRITICAL,
        MILD: URGENCY_LEVELS.HIGH
    }
};

// Time Contexts (absolute medical terms)
export const TIME_CONTEXTS = {
    IMMEDIATE: 'immediate',     // < 1 hour
    ACUTE: 'acute',             // < 24 hours  
    RECENT: 'recent',          // < 1 month (context-dependent)
    CHRONIC: 'chronic'         // > 1 month
};

// Medical Analysis Constants
export const MEDICAL_SYMPTOMS = [
    'chest pain', 'chest discomfort', 'dizziness', 'headache', 
    'nausea', 'fatigue', 'tired', 'shortness of breath', 'breathing difficulty',
    'bleeding', 'blood', 'pain', 'fever', 'vomiting', 'diarrhea', 'constipation',
    'rash', 'swelling', 'numbness', 'tingling', 'weakness', 'confusion'
];

export const PATIENT_CONCERNS = [
    'medication', 'medicine', 'pills', 'pain', 'symptoms', 'appointment', 
    'doctor', 'help', 'worried', 'concerned', 'scared', 'anxious', 'stressed',
    'schedule', 'reminder', 'tracking', 'monitoring', 'side effects'
];

export const EMPATHY_LOOP_PHRASES = [
    'i understand how you feel',
    'i understand how',
    'i understand that',
    'i can understand',
    'i know how',
    'i know that',
    'i can see how',
    'i can imagine',
    'that must be',
    'i\'m sorry you\'re feeling'
];

export const URGENCY_KEYWORDS = {
    CRITICAL: ['severe', 'emergency', 'urgent', 'immediate', 'can\'t breathe', 'unconscious', 'bleeding'],
    HIGH: ['serious', 'worse', 'increasing', 'getting worse', 'concerned', 'worried'],
    MEDIUM: ['moderate', 'bothering', 'troubling', 'annoying', 'uncomfortable'],
    LOW: ['mild', 'slight', 'minor', 'occasional', 'sometimes']
};

export const TIME_KEYWORDS = {
    IMMEDIATE: ['now', 'right now', 'sudden', 'just started', 'immediately'],
    ACUTE: ['today', 'this morning', 'recently', 'last few hours', 'since'],
    RECENT: ['this week', 'past few days', 'lately', 'recently'],
    CHRONIC: ['weeks', 'months', 'years', 'always', 'chronic', 'ongoing']
};
