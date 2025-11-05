/**
 * @fileoverview Basic scenarios - single-user, fundamental interactions
 */

export const BASIC_SCENARIOS = {
    elderly_cognitive: {
        name: '👴 Elderly Cognitive Decline - Daily Living Support',
        description: 'Memory issues, confusion, word-finding difficulties. Focus on daily routines, independence, and lifestyle management for elderly with memory issues',
        category: 'basic',
        complexity: 2,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'Focus on behavioral support: daily routines, medication adherence, social connections, safety concerns, maintaining independence, confusion, word-finding difficulties, memory issues.',
            caregiver: 'You are actively monitoring the patient\'s cognitive changes, helping with daily routines, and coordinating care. You notice memory issues and want to help maintain independence.',
            agent: 'Support both patient independence and caregiver concerns about safety and daily functioning.'
        },
        turns: 8
    },
    
    medication_nonadherent: {
        name: '💊 Medication Non-Adherent',
        description: 'Forgets/skips medications, makes excuses. Focus on building healthy medication routines and addressing barriers to adherence',
        category: 'basic',
        complexity: 2,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'Focus on behavioral support: understanding barriers to medication adherence, building routines, addressing forgetfulness, and creating sustainable habits. Avoid clinical discussions about drug interactions.',
            caregiver: 'You are very concerned about medication adherence and want to help the patient stay on track. You notice missed doses and want to understand why.',
            agent: 'Help address medication adherence barriers while respecting patient autonomy and caregiver concerns.'
        },
        turns: 8
    },
    
    denial_prone: {
        name: '🙈 Denial-Prone Patient',
        description: 'Minimizes symptoms, resists help',
        category: 'basic',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You tend to minimize symptoms and resist help. You want to maintain independence and don\'t want to worry others.',
            caregiver: 'You notice the patient is minimizing symptoms and you\'re concerned about their health. You want to help but they resist.',
            agent: 'Navigate between patient denial and caregiver concern, helping both communicate effectively.'
        },
        turns: 8
    },
    
    anxious_patient: {
        name: '😰 Highly Anxious',
        description: 'Catastrophizes symptoms, excessive worry',
        category: 'basic',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'burned_out_caregiver' }
        ],
        instructions: {
            patient: 'You catastrophize symptoms and worry excessively. You need reassurance but also want to understand what\'s happening.',
            caregiver: 'You\'re feeling burned out from the patient\'s constant anxiety and worry. You want to help but feel overwhelmed.',
            agent: 'Help manage patient anxiety while supporting the caregiver\'s emotional needs.'
        },
        turns: 8
    }
};

