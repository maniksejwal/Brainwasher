/**
 * Palliative care scenarios
 */

export const PALLIATIVE_SCENARIOS = {
    screen_time_advanced_dry_eye: {
        name: '🔬 Screen Time - Advanced Dry Eye (Palliative)',
        description: 'Palliative care for advanced dry eye disease with multiple contributing factors',
        category: 'palliative',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' },
            { role: 'doctor', personaKey: 'empathetic_doctor' }
        ],
        instructions: {
            patient: 'You have severe dry eye disease with MGD, blepharitis, and age-related changes. Screen use makes it much worse. You\'re frustrated with multiple treatments and want to understand what\'s happening.',
            caregiver: 'You\'re managing the patient\'s complex eye care routine. You need to understand the condition to help effectively.',
            doctor: 'You\'re providing specialized care for advanced dry eye. You need to explain complex pathophysiology in understandable terms.',
            agent: 'ASSESS: Does the agent explain complex pathophysiology (tear film layers, gland function, inflammation cycles)? Does it use analogies for complex concepts? Does it address quality of life impacts? Does it provide hope while being realistic?'
        }
    }
};

