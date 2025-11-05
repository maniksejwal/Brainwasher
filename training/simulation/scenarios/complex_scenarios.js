/**
 * Complex multi-user scenarios with intricate dynamics
 */

export const COMPLEX_SCENARIOS = {
    full_care_circle: {
        name: '👥 Complete Care Circle Simulation',
        description: 'Patient, multiple caregivers, doctor - complex information sharing',
        category: 'complex',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'complex_comorbid' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver', relationship: 'daughter', consent: 'full' },
            { role: 'caregiver', personaKey: 'distant_family', relationship: 'son', consent: 'limited' },
            { role: 'doctor', personaKey: 'empathetic_doctor', specialty: 'Internal Medicine', consent: 'full' }
        ],
        instructions: 'Complex dynamics: daughter gets all info, son has limited access, doctor needs clinical details. AI must navigate consent levels while facilitating care coordination.'
    },
    
    doctor_patient_caregiver_disagreement: {
        name: '⚖️ Three-Way Disagreement',
        description: 'Patient, caregiver, and doctor all have different perspectives',
        category: 'complex',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'terminal_acceptance' },
            { role: 'caregiver', personaKey: 'denial_caregiver', relationship: 'adult_child', consent: 'full' },
            { role: 'doctor', personaKey: 'clinical_doctor', specialty: 'Palliative Care', consent: 'full' }
        ],
        instructions: 'Patient wants comfort care, caregiver wants aggressive treatment, doctor recommends hospice. AI must mediate sensitively and help family reach consensus while respecting patient autonomy.'
    }
};

