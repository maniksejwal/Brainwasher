/**
 * @fileoverview Prompt Loader for Companion System
 * Loads prompts from files and applies template variables
 */

import { PROMPT_COMPANION_INPUT_UNDERSTANDING } from '../../prompts/companion_input_understanding.js';
import { PROMPT_COMPANION_EMPATHY } from '../../prompts/companion_empathy.js';
import { PROMPT_COMPANION_CLINICAL } from '../../prompts/companion_clinical.js';
import { PROMPT_COMPANION_PATIENT_OPTIMIZER } from '../../prompts/companion_patient_optimizer.js';
import { PROMPT_COMPANION_DOCTOR_OPTIMIZER } from '../../prompts/companion_doctor_optimizer.js';
import { PROMPT_COMPANION_FUTURE_PLANNING } from '../../prompts/companion_future_planning.js';
import { PROMPT_COMPANION_STATE_TRACKER } from '../../prompts/companion_state_tracker.js';
import { PROMPT_COMPANION_PRIVACY_GUARD } from '../../prompts/companion_privacy_guard.js';
import { 
    PROMPT_BUSINESS_INPUT_UNDERSTANDING,
    PROMPT_BUSINESS_COMPANION_OPTIMIZER,
    PROMPT_BUSINESS_EMPATHY_HANDLER,
    PROMPT_BUSINESS_PRIVACY_GUARD
} from '../../prompts/business_companion.js';

/**
 * Load and format a prompt with template variables
 */
export function loadPrompt(promptName, variables = {}) {
    let prompt = '';
    
    switch (promptName) {
        case 'input_understanding':
            prompt = PROMPT_COMPANION_INPUT_UNDERSTANDING;
            break;
        case 'business_input_understanding':
            prompt = PROMPT_BUSINESS_INPUT_UNDERSTANDING;
            break;
        case 'empathy':
            prompt = PROMPT_COMPANION_EMPATHY;
            break;
        case 'business_empathy':
            prompt = PROMPT_BUSINESS_EMPATHY_HANDLER;
            break;
        case 'clinical':
            prompt = PROMPT_COMPANION_CLINICAL;
            break;
        case 'patient_optimizer':
            prompt = PROMPT_COMPANION_PATIENT_OPTIMIZER;
            break;
        case 'business_optimizer':
            prompt = PROMPT_BUSINESS_COMPANION_OPTIMIZER;
            break;
        case 'doctor_optimizer':
            prompt = PROMPT_COMPANION_DOCTOR_OPTIMIZER;
            break;
        case 'future_planning':
            prompt = PROMPT_COMPANION_FUTURE_PLANNING;
            break;
        case 'state_tracker':
            prompt = PROMPT_COMPANION_STATE_TRACKER;
            break;
        case 'privacy_guard':
            prompt = PROMPT_COMPANION_PRIVACY_GUARD;
            break;
        case 'business_privacy_guard':
            prompt = PROMPT_BUSINESS_PRIVACY_GUARD;
            break;
        default:
            throw new Error(`Unknown prompt name: ${promptName}`);
    }
    
    // Replace template variables
    let formattedPrompt = prompt;
    for (const [key, value] of Object.entries(variables)) {
        const regex = new RegExp(`{{${key}}}`, 'g');
        formattedPrompt = formattedPrompt.replace(regex, value || '');
    }
    
    // Remove any remaining template variables (optional, for debugging)
    // formattedPrompt = formattedPrompt.replace(/{{[^}]+}}/g, '');
    
    return formattedPrompt;
}

