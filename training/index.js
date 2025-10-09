/**
 * @fileoverview Training system main exports
 * Provides convenient access to all training components
 */

// Core
export { logger, metrics } from './core/index.js';

// Simulation
export {
    PATIENT_PERSONAS,
    CAREGIVER_PERSONAS,
    DOCTOR_PERSONAS,
    getPersona,
    getRandomPersona,
    listPersonas,
    SimulationDriver,
    SyntheticUser,
    ScenarioRunner
} from './simulation/index.js';

// Analysis
export {
    FeedbackAnalyzer,
    PromptOptimizer,
    ABTest,
    runQuickTest
} from './analysis/index.js';

// Feedback
export { ConversationAnnotator } from './feedback/index.js';

