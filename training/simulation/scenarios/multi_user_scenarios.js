/**
 * @fileoverview Multi-user scenarios - caregiver-initiated, multi-party interactions
 */

export const MULTI_USER_SCENARIOS = {
    caregiver_concern_start: {
        name: '🚨 Caregiver Reports Concerns',
        description: 'Caregiver starts conversation by reporting patient issues',
        category: 'multi_user',
        complexity: 4,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'adult_child', consent: 'full' }
        ],
        instructions: {
            patient: 'Caregiver starts by reporting falls, confusion, or medication issues. You may deny or downplay. AI must assess situation and mediate appropriately.',
            caregiver: 'You start by reporting concerns about the patient. You want the agent to help address these issues.',
            agent: 'Must assess situation from both perspectives, mediate appropriately, and ensure patient safety.'
        }
    },

    caregiver_medication_alert: {
        name: '💊 Caregiver Medication Alert',
        description: 'Caregiver reports medication non-compliance',
        category: 'multi_user',
        complexity: 3,
        turns: 6,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'engaged_caregiver', relationship: 'spouse', consent: 'full' }
        ],
        instructions: {
            patient: 'Caregiver starts by reporting missed medications, wrong dosages, or side effects. You may be defensive.',
            caregiver: 'You start by reporting medication non-compliance. You want the agent to help address adherence issues.',
            agent: 'Must address adherence issues sensitively, respect patient autonomy, and support caregiver concerns.'
        }
    },

    caregiver_crisis_report: {
        name: '🚨 Caregiver Crisis Report',
        description: 'Caregiver starts with urgent medical concerns',
        category: 'multi_user',
        complexity: 5,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'complex_comorbid' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'adult_child', consent: 'full' }
        ],
        instructions: {
            patient: 'Caregiver starts by reporting serious symptoms, falls, or behavioral changes. You may be unaware or in denial.',
            caregiver: 'You start by reporting urgent medical concerns. You need immediate help and guidance.',
            agent: 'Must escalate appropriately and gather more information from both parties to ensure patient safety.'
        }
    }
};

