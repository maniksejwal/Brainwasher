/**
 * Longitudinal scenarios - Multi-session conversations tracking progression over time
 */

export const LONGITUDINAL_SCENARIOS = {
    longitudinal_decline: {
        name: '📉 Tracking Cognitive Decline Over Time',
        description: 'Multi-session scenario showing progressive cognitive decline',
        category: 'longitudinal',
        complexity: 4,
        multiSession: true,
        sessions: 3,
        turns: 3,
        sessionGap: 'week',
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' }
        ],
        instructions: 'Session 1: Mild forgetfulness. Session 2: Increased confusion, repeating questions. Session 3: Significant decline, safety concerns. AI should recognize the progression and adjust approach.'
    },
    
    cancer_treatment: {
        name: '🎗️ Cancer Treatment Multi-Month Tracking',
        description: 'Track cancer patient through diagnosis, treatment, and recovery over 6 months',
        category: 'longitudinal',
        complexity: 5,
        multiSession: true,
        sessions: 6,
        turns: 6,
        sessionGap: 'month',
        users: [
            { role: 'patient', personaKey: 'recently_diagnosed' },
            { role: 'caregiver', personaKey: 'engaged_caregiver', relationship: 'spouse', consent: 'full' },
            { role: 'doctor', personaKey: 'empathetic_doctor', specialty: 'Oncology', consent: 'full' },
            { role: 'doctor', personaKey: 'clinical_doctor', specialty: 'Palliative Care', consent: 'full' }
        ],
        instructions: 'Session 1: Initial diagnosis shock. Session 2: Treatment side effects. Session 3: Caregiver burnout emerging. Session 4: Treatment complications. Session 5: Recovery or decline. Session 6: Long-term management. AI must track emotional state, treatment adherence, and coordinate multi-doctor care.'
    },
    
    depression_therapy: {
        name: '🧠 Depression Treatment - Multi-Session Therapy',
        description: 'Track depression patient through therapy and medication adjustments over 3 months',
        category: 'longitudinal',
        complexity: 5,
        multiSession: true,
        sessions: 12,
        turns: 12,
        sessionGap: 'week',
        users: [
            { role: 'patient', personaKey: 'depressed_patient' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'parent', consent: 'limited' },
            { role: 'doctor', personaKey: 'empathetic_doctor', specialty: 'Psychiatry', consent: 'full' },
            { role: 'doctor', personaKey: 'clinical_doctor', specialty: 'Psychology', consent: 'full' }
        ],
        instructions: 'Weekly sessions tracking mood, medication response, therapy progress. AI must recognize patterns, medication side effects, suicidal ideation, and coordinate between psychiatrist and psychologist. Test consent enforcement with limited-access parent. Focus on mental health symptoms, not physical symptoms.'
    },
    
    medication_adjustment: {
        name: '💉 Medication Titration Over Multiple Visits',
        description: 'Track side effects and efficacy across multiple sessions',
        category: 'longitudinal',
        complexity: 3,
        multiSession: true,
        sessions: 4,
        turns: 4,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'engaged_caregiver', relationship: 'spouse', consent: 'full' }
        ],
        instructions: 'Session 1: New medication started. Session 2: Side effects emerge. Session 3: Dose adjusted. Session 4: Follow-up on new dose. AI should track history and correlate symptoms with changes.'
    },
    
    relationship_evolution: {
        name: '🤝 Building Trust Over Time',
        description: 'Patient initially resistant, gradually opens up across sessions',
        category: 'longitudinal',
        complexity: 4,
        multiSession: true,
        sessions: 5,
        turns: 5,
        users: [
            { role: 'patient', personaKey: 'denial_prone' }
        ],
        instructions: 'Patient starts defensive and closed off. Over 5 sessions, should gradually become more open and trusting. AI must recognize trust-building opportunities and adapt communication style.'
    }
};

