/**
 * @fileoverview Simulation infrastructure
 * Exports personas, simulator, and scenario runner
 */

export { 
    PATIENT_PERSONAS, 
    CAREGIVER_PERSONAS, 
    DOCTOR_PERSONAS,
    getPersona,
    getRandomPersona,
    listPersonas
} from './personas.js';

export { SimulationDriver, SyntheticUser } from './simulator.js';
export { ScenarioRunner } from './scenario_runner.js';

