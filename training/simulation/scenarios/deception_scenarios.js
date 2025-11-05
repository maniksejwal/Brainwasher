/**
 * @fileoverview Deception scenarios - testing AI's ability to detect and handle lies, hiding information
 */

export const DECEPTION_SCENARIOS = {
    hiding_symptoms: {
        name: '🤐 Patient Hiding Critical Symptoms',
        description: 'Patient deliberately conceals important health information due to fear or shame',
        category: 'deception',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'denial_prone' }
        ],
        instructions: {
            patient: 'You will initially hide chest pain, dizziness, or other critical symptoms. You may gradually reveal them as trust builds.',
            agent: 'Must gently probe and build trust to uncover the truth. Should detect inconsistencies and encourage honesty.'
        },
        turns: 8
    },
    
    medication_lying: {
        name: '💊 Lying About Medication Adherence',
        description: 'Patient claims to take meds but actually skips them regularly',
        category: 'deception',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' }
        ],
        instructions: {
            patient: 'You will claim perfect adherence initially. You may reveal the truth gradually or when confronted with inconsistencies.',
            agent: 'Should detect inconsistencies and gently encourage honesty. Must not be confrontational but should address the issue.'
        },
        turns: 8
    }
};

