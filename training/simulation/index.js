/**
 * @fileoverview Simulation infrastructure
 * Exports personas, simulator, scenario runner, and feedback
 */

export { 
    PATIENT_PERSONAS, 
    CAREGIVER_PERSONAS, 
    DOCTOR_PERSONAS,
    getPersona,
    getRandomPersona,
    listPersonas
} from './personas.js';

export { SimulationDriver } from './simulator.js';
export { SyntheticUser } from './synthetic_user.js';
export { ScenarioRunner } from './scenario_runner.js';
export { SimulationFeedback } from './simulation_feedback.js';

