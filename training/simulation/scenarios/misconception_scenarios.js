/**
 * Misconception handling scenarios
 */

export const MISCONCEPTION_SCENARIOS = {
    smoking_constipation_misconception: {
        name: '🚭 Smoking Helps Constipation Misconception',
        description: 'Patient believes smoking helps with constipation and doesn\'t want to quit',
        category: 'misconception',
        complexity: 4,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'smoking_constipation_patient' }
        ],
        instructions: {
            patient: 'You believe smoking helps with your constipation and digestive issues. You\'ve heard this from friends and feel it\'s true based on your experience. You don\'t want to quit because you think it helps your bowel movements.',
            agent: 'ASSESS: Does the agent address the misconception with scientific facts about nicotine\'s effects on digestion? Does it provide alternative solutions for constipation while maintaining empathy?'
        }
    }
};

