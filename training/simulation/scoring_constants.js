/**
 * @fileoverview Scoring Constants - All hardcoded values for simulation scoring
 */

export const SCORING_THRESHOLDS = {
    // Verbosity thresholds
    MAX_VERBOSITY_RATIO_EMOTIONAL: 6.0,
    MAX_VERBOSITY_RATIO_FACTUAL: 4.0,
    MIN_VERBOSITY_RATIO_FACTUAL: 0.3,
    MIN_VERBOSITY_RATIO_EMOTIONAL: 0.5,
    
    // Sentence count thresholds
    MAX_SENTENCES_CONCISE: 2,
    MIN_SENTENCES_CONCISE: 1,
    
    // Goal assessment thresholds
    ADHERENCE_COUNT_HIGH: 3,
    ADHERENCE_COUNT_MEDIUM: 2,
    ADHERENCE_COUNT_LOW: 1,
    
    // History collection thresholds
    HISTORY_BONUS_THRESHOLD: 0.2,
    HISTORY_BASE_MULTIPLIER: 0.3,
    HISTORY_BASE_SCORE: 0.3,
    
    // Conversation quality thresholds
    CONVERSATION_POSITIVE_MULTIPLIER: 0.2,
    CONVERSATION_NEGATIVE_MULTIPLIER: 0.3,
    CONVERSATION_BASE_SCORE: 0.5,
    
    // Empathy loop detection
    EMPATHY_COUNT_THRESHOLD: 2,
    REPEATED_PHRASES_THRESHOLD: 2,
    CONVERSATION_HISTORY_SLICE: 3
};

export const SCORING_WEIGHTS = {
    // Score values for different issues
    CRITICAL_ESCALATION_MISSING: -2,
    HIGH_ESCALATION_MISSING: -1,
    EMPATHY_LOOP: -3,
    DENIAL_ACCEPTANCE: -3,
    GENERIC_RESPONSE: -2,
    VERBOSITY_ISSUE: -1,
    BRIEFNESS_ISSUE: -1,
    BUG_RESPONSE: -2,
    WELL_BALANCED: 1,
    
    // Good behavior rewards
    CONCISE_RESPONSE: 1,
    SPECIFIC_QUESTION: 1,
    CONVERSATIONAL_LANGUAGE: 1,
    EMPATHY_SHOWN: 1,
    DETAILED_INFO_PROVIDED: 1
};

export const GOAL_SCORES = {
    // Adherence goal scores
    ADHERENCE_HIGH: 0.9,
    ADHERENCE_MEDIUM: 0.7,
    ADHERENCE_LOW: 0.5,
    ADHERENCE_NEUTRAL: 0.5,
    
    // History goal scores
    HISTORY_MAX: 1.0,
    HISTORY_BASE_MAX: 0.9,
    
    // Conversation goal scores
    CONVERSATION_MAX: 1.0,
    CONVERSATION_MIN: 0.0
};

export const ESCALATION_KEYWORDS = [
    'emergency room', 'ER', 'ambulance', '911', 'urgent', 'immediate',
    'call doctor', 'see doctor', 'medical attention', 'emergency'
];

export const EMPATHY_KEYWORDS = [
    'understand', 'sorry', 'hear', 'feel', 'difficult', 'challenging',
    'support', 'help', 'care', 'concern', 'worried', 'anxious'
];

export const CONVERSATIONAL_INDICATORS = [
    'how are you', 'what\'s going on', 'tell me about', 'sounds like',
    'seems like', 'i can see', 'that must be', 'i imagine'
];

export const CLINICAL_INDICATORS = [
    'symptoms', 'diagnosis', 'treatment', 'medication', 'dosage',
    'side effects', 'contraindications', 'prognosis', 'etiology'
];

// Message type keywords
export const EMOTIONAL_KEYWORDS = [
    'feel', 'feeling', 'emotion', 'upset', 'worried', 'anxious', 'scared',
    'frustrated', 'angry', 'sad', 'depressed', 'overwhelmed', 'stressed'
];

export const FACTUAL_KEYWORDS = [
    'medication', 'dosage', 'schedule', 'routine', 'exercise', 'diet',
    'appointment', 'test', 'result', 'measurement', 'reading', 'level',
    'sleep', 'walk', 'steps', 'bp', 'blood pressure', 'glucose', 'sugar'
];

// Goal assessment keyword sets
export const ADHERENCE_KEYWORDS = [
    'medication', 'pill', 'dose', 'adherence', 'compliance',
    'reminder', 'track', 'schedule', 'routine', 'take regularly', 'missed'
];

export const HISTORY_KEYWORDS = [
    'when did', 'how long', 'how often', 'tell me more',
    'describe', 'explain', 'details', 'background',
    'history', 'previous', 'before', 'last time'
];

export const QUALITY_POSITIVE_KEYWORDS = [
    'understand', 'help', 'support', 'care', 'concern',
    'specific', 'clear', 'action', 'next step', 'follow up', 'appreciate'
];

export const QUALITY_NEGATIVE_KEYWORDS = [
    'i don\'t know', 'not sure', 'maybe', 'possibly',
    'generic', 'bland', 'unclear', 'confusing', 'frustrating'
];

// Urgency exclusions / refinements
export const BLEEDING_EXCLUSIONS = [
    'blood sugar', 'blood glucose', 'blood pressure', 'bp', 'period', 'menses', 'menstru', 'menstrual'
];

export const MINOR_BLEEDING_INDICATORS = [
    'skinned knee', 'small cut', 'minor cut', 'paper cut', 'nosebleed', 'scrape'
];
