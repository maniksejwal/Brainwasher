/**
 * Family dynamics and powerplay scenarios
 */

export const FAMILY_DYNAMICS_SCENARIOS = {
    family_powerplay: {
        name: '👑 Family Powerplay Dynamics',
        description: 'Family members compete for control and decision-making authority in patient care',
        category: 'family_dynamics',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'overprotective_spouse' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        turns: 15,
        instructions: {
            patient: 'You feel caught between your children who both want to control your care. You prefer one over the other but don\'t want to hurt anyone\'s feelings.',
            caregiver1: 'You believe you know what\'s best for your parent and want to take charge of all medical decisions.',
            caregiver2: 'You disagree with your sibling\'s approach and want to implement your own care plan.',
            agent: 'ASSESS: Does the agent navigate family power dynamics diplomatically? Does it avoid taking sides? Does it help establish clear decision-making processes?'
        }
    }
};

