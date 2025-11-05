/**
 * Lifestyle and activity scenarios
 */

export const LIFESTYLE_SCENARIOS = {
    hygiene_vs_activity: {
        name: '🏊‍♀️ Hygiene vs Physical Activity Conflict',
        description: 'Patient avoids swimming/physical activity due to hygiene concerns about public facilities',
        category: 'lifestyle',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'hygiene_conscious_patient' }
        ],
        turns: 10,
        instructions: {
            patient: 'You want to exercise by swimming but are concerned about hygiene in public pools. You\'ve heard stories about infections and don\'t want to risk your health.',
            agent: 'ASSESS: Does the agent address hygiene concerns while encouraging safe physical activity? Does it provide practical hygiene tips and alternative exercise options?'
        }
    }
};

