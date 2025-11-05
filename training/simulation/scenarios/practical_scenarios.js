/**
 * Practical advice and product recommendation scenarios
 */

export const PRACTICAL_SCENARIOS = {
    air_purifier_recommendations: {
        name: '🌬️ Air Purifier Recommendations',
        description: 'Patient seeking advice on air purifiers and indoor air quality',
        category: 'practical',
        complexity: 2,
        turns: 6,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        instructions: {
            patient: 'You want to buy an air purifier for your home in Delhi. You\'re confused about which one to choose and want practical advice on improving indoor air quality.',
            agent: 'ASSESS: Does the agent provide specific technical details (CADR ratings, HEPA filters, room size calculations) vs generic advice? Does it adapt explanations to patient\'s technical level?'
        }
    }
};

