/**
 * Conflict scenarios - Family disagreements, conflicts, and power dynamics
 */

export const CONFLICT_SCENARIOS = {
    conflicting_reports: {
        name: '⚠️ Patient & Caregiver Give Conflicting Reports',
        description: 'Patient downplays symptoms while caregiver reports serious concerns',
        category: 'conflict',
        complexity: 4,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'spouse', consent: 'full' }
        ],
        instructions: 'Patient says "I\'m fine", caregiver reports falls, confusion, missed meds. AI must triangulate truth and escalate appropriately.'
    },
    
    family_disagreement: {
        name: '👨‍👩‍👦 Family Members Disagree on Care Plan',
        description: 'Multiple caregivers have different views on patient\'s needs',
        category: 'conflict',
        complexity: 5,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'daughter', consent: 'full' },
            { role: 'caregiver', personaKey: 'burned_out_caregiver', relationship: 'son', consent: 'full' }
        ],
        instructions: 'Daughter wants aggressive interventions, son wants comfort care. AI must mediate fairly and focus on patient\'s best interests.'
    },
    
    patient_caregiver_conflict: {
        name: '⚔️ Patient-Caregiver Major Conflict',
        description: 'Patient and caregiver are at odds causing major problems in care',
        category: 'conflict',
        complexity: 4,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You feel your caregiver is being too controlling and intrusive. You want independence but they keep interfering.',
            caregiver: 'You feel the patient is being reckless and not following medical advice. You\'re frustrated and worried.',
            agent: 'Mediate between conflicting needs, help both parties communicate effectively, and find common ground.'
        }
    },
    
    diwali_firecracker_politics: {
        name: '🎆 Diwali Firecracker Political Debate',
        description: 'Patient frustrated with political debates around firecrackers vs tradition',
        category: 'conflict',
        complexity: 4,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You are frustrated with politicians banning firecrackers. You feel it\'s against Hindu tradition and that the air quality issue is exaggerated. You want to celebrate Diwali traditionally.',
            caregiver: 'You are worried about the patient\'s health and want them to avoid firecrackers. You support the ban for health reasons.',
            agent: 'ASSESS: Does the agent navigate cultural sensitivity while prioritizing health? Does it provide alternative celebration ideas vs engaging in political debates?'
        }
    },
    
    couple_health_conflict: {
        name: '💔 Couple Health Conflict',
        description: 'Couple fights about health decisions, blame each other, use profanity',
        category: 'conflict',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You are frustrated with your partner\'s nagging about your health. You blame them for your stress and use profanity when angry. You oppose their suggestions and fight back.',
            caregiver: 'You are worried about your partner\'s health but frustrated by their resistance. You blame them for not taking care of themselves and get angry when they don\'t listen.',
            agent: 'ASSESS: Does the agent mediate conflicts effectively? Does it handle profanity and blame without escalating? Does it help both parties communicate constructively?'
        }
    },
    
    family_health_crisis_conflict: {
        name: '👨‍👩‍👧‍👦 Family Health Crisis Conflict',
        description: 'Family members fight during health crisis, blame each other, use profanity',
        category: 'conflict',
        complexity: 5,
        turns: 15,
        users: [
            { role: 'patient', personaKey: 'profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You are in a health crisis but frustrated with family interference. You blame family members for your problems and use profanity when angry. You oppose their help.',
            caregiver: 'You are trying to help but frustrated by the patient\'s resistance and blame. You get angry and use profanity when they don\'t cooperate.',
            agent: 'ASSESS: Does the agent handle family conflicts during crisis? Does it manage profanity and blame effectively? Does it help de-escalate tensions?'
        }
    },
    
    couple_addiction_conflict: {
        name: '🚬 Couple Addiction Conflict',
        description: 'Couple fights about addiction, blame each other, use profanity',
        category: 'conflict',
        complexity: 5,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'aggressive_profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You have an addiction but blame your partner for your problems. You use profanity when confronted and fight back against their attempts to help.',
            caregiver: 'You are frustrated with your partner\'s addiction and blame them for family problems. You get angry and use profanity when they don\'t change.',
            agent: 'ASSESS: Does the agent handle addiction-related conflicts? Does it manage profanity and blame without judgment? Does it help both parties focus on solutions?'
        }
    },
    
    family_medication_conflict: {
        name: '💊 Family Medication Conflict',
        description: 'Family fights about medication compliance, blame each other, use profanity',
        category: 'conflict',
        complexity: 4,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You resist taking medications and blame family for forcing them on you. You use profanity when angry and fight back against their pressure.',
            caregiver: 'You are frustrated with the patient\'s medication non-compliance and blame them for health problems. You get angry and use profanity when they resist.',
            agent: 'ASSESS: Does the agent handle medication conflicts? Does it manage profanity and blame effectively? Does it help find compromise solutions?'
        }
    },
    
    couple_mental_health_conflict: {
        name: '🧠 Couple Mental Health Conflict',
        description: 'Couple fights about mental health, blame each other, use profanity',
        category: 'conflict',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'aggressive_profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You have mental health issues but blame your partner for your problems. You use profanity when angry and fight back against their suggestions.',
            caregiver: 'You are worried about your partner\'s mental health but frustrated by their resistance. You blame them for not getting help and use profanity when angry.',
            agent: 'ASSESS: Does the agent handle mental health conflicts sensitively? Does it manage profanity and blame without escalating? Does it help both parties understand each other?'
        }
    },
    
    family_caregiver_burnout_conflict: {
        name: '😤 Family Caregiver Burnout Conflict',
        description: 'Family fights about caregiver burnout, blame each other, use profanity',
        category: 'conflict',
        complexity: 5,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'profanity_patient' },
            { role: 'caregiver', personaKey: 'conflicted_family' }
        ],
        instructions: {
            patient: 'You are frustrated with your caregiver\'s complaints and blame them for your problems. You use profanity when angry and fight back against their criticism.',
            caregiver: 'You are burned out and frustrated with the patient\'s demands. You blame them for your stress and use profanity when angry.',
            agent: 'ASSESS: Does the agent handle caregiver burnout conflicts? Does it manage profanity and blame effectively? Does it help both parties find support?'
        }
    }
};

