/**
 * Curative treatment scenarios
 */

export const CURATIVE_SCENARIOS = {
    screen_time_mgd_treatment: {
        name: '👁️ Screen Time - MGD Treatment (Curative)',
        description: 'Curative approach for established Meibomian Gland Dysfunction from excessive screen time',
        category: 'curative',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You have diagnosed MGD and dry eye disease from years of screen use. You\'re prescribed warm compresses, artificial tears, and lifestyle changes. You struggle with compliance and understanding the treatment.',
            caregiver: 'You\'re helping the patient manage their MGD treatment. You notice they skip warm compresses and don\'t understand why the treatment is important.',
            agent: 'ASSESS: Does the agent explain MGD pathophysiology? Does it educate about meibomian gland anatomy and function? Does it explain why warm compresses work? Does it address compliance barriers and provide practical solutions?'
        }
    }
};

