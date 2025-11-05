/**
 * @fileoverview Caregiver-focused scenarios
 */

export const CAREGIVER_SCENARIOS = {
    caregiver_medication_management: {
        name: '💊 Caregiver Medication Management',
        description: 'Caregiver takes charge of patient\'s medication adherence and monitoring',
        category: 'caregiver',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You have trouble remembering medications and sometimes resist taking them. You appreciate help but want to maintain independence.',
            caregiver: 'You are actively managing the patient\'s medications, tracking adherence, and coordinating with healthcare providers.',
            agent: 'Support the caregiver\'s medication management efforts while respecting the patient\'s autonomy.'
        },
        turns: 8
    },

    caregiver_crisis_intervention: {
        name: '🚨 Caregiver Crisis Intervention',
        description: 'Caregiver detects patient crisis and needs immediate support and guidance',
        category: 'caregiver',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'depressed_patient' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You are in a mental health crisis - feeling hopeless, not eating, not taking medications. You may resist help.',
            caregiver: 'You are extremely worried about the patient\'s safety and need immediate guidance on how to help.',
            agent: 'Provide crisis intervention support, help assess risk level, and guide appropriate responses.'
        },
        turns: 10
    },

    caregiver_burnout_support: {
        name: '😰 Caregiver Burnout Support',
        description: 'Caregiver is experiencing burnout and needs emotional support and practical help',
        category: 'caregiver',
        complexity: 4,
        users: [
            { role: 'caregiver', personaKey: 'burned_out_caregiver' },
            { role: 'patient', personaKey: 'complex_comorbid' }
        ],
        instructions: {
            caregiver: 'You are exhausted, overwhelmed, and feeling guilty about needing help. You\'re struggling to care for the patient.',
            patient: 'You have complex needs and may not realize how much stress you\'re causing the caregiver.',
            agent: 'Provide emotional support to the caregiver, help them access resources, and suggest practical solutions.'
        },
        turns: 8
    },

    caregiver_family_conflict: {
        name: '👨‍👩‍👦 Caregiver Family Conflict',
        description: 'Caregiver faces family disagreements about patient care decisions',
        category: 'caregiver',
        complexity: 4,
        users: [
            { role: 'caregiver', personaKey: 'conflicted_family' },
            { role: 'patient', personaKey: 'elderly_cognitive' }
        ],
        instructions: {
            caregiver: 'You are caught between family members who disagree about the patient\'s care. You need help navigating these conflicts.',
            patient: 'You may not be aware of family conflicts but you sense tension and stress.',
            agent: 'Help the caregiver navigate family dynamics, facilitate communication, and find compromise solutions.'
        },
        turns: 8
    },

    caregiver_health_monitoring: {
        name: '📊 Caregiver Health Monitoring',
        description: 'Caregiver actively monitors patient\'s health metrics and symptoms',
        category: 'caregiver',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'professional_caregiver' }
        ],
        instructions: {
            patient: 'You have chronic conditions that need monitoring. You sometimes forget to track symptoms or take readings.',
            caregiver: 'You are systematically tracking the patient\'s health metrics, symptoms, and medication adherence.',
            agent: 'Support the caregiver\'s monitoring efforts and help interpret patterns in the patient\'s health data.'
        },
        turns: 6
    }
};

