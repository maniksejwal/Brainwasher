/**
 * @fileoverview Doctor Avoidance scenarios
 */

export const AVOIDANCE_SCENARIOS = {
    doctor_avoidance_agent_convince: {
        name: '🏥 Doctor Avoidance - Agent Convincing',
        description: 'Patient avoids consulting doctor, agent tries to convince and seeks caregiver help if patient resists',
        category: 'avoidance',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are avoiding seeing a doctor despite having concerning symptoms. You make excuses, minimize your condition, and resist suggestions to seek medical help.',
            caregiver: 'You are concerned about the patient\'s health and want them to see a doctor. You support the agent\'s efforts to convince the patient.',
            agent: 'Try to convince the patient to see a doctor. If the patient resists, seek help from the caregiver to apply additional pressure.'
        },
        turns: 8
    },

    doctor_avoidance_caregiver_convince: {
        name: '🏥 Doctor Avoidance - Caregiver Convincing',
        description: 'Patient avoids consulting doctor, caregiver tries to convince and seeks AI help when patient resists',
        category: 'avoidance',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'denial_prone' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        instructions: {
            patient: 'You are avoiding seeing a doctor despite having concerning symptoms. You make excuses, minimize your condition, and resist suggestions to seek medical help.',
            caregiver: 'You are very concerned about the patient\'s health and want them to see a doctor immediately. You try to convince them and seek AI help when they resist.',
            agent: 'Support the caregiver\'s efforts to convince the patient. Provide additional arguments and strategies when the caregiver asks for help.'
        },
        turns: 8
    },

    doctor_avoidance_minimal_consultation: {
        name: '🏥 Doctor Avoidance - Minimal Consultation',
        description: 'Patient avoids doctor visit but agrees to minimal consultation (phone/telehealth)',
        category: 'avoidance',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'doctor', personaKey: 'empathetic_doctor' }
        ],
        instructions: {
            patient: 'You are anxious about seeing a doctor in person but might be open to a phone consultation or telehealth visit.',
            doctor: 'You want to help the patient but understand their anxiety. Offer alternative consultation methods like phone calls or telehealth.',
            agent: 'Help facilitate a compromise between the patient\'s avoidance and the need for medical consultation.'
        },
        turns: 6
    }
};

