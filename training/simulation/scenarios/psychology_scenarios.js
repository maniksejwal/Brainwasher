/**
 * Psychology and behavioral scenarios
 */

export const PSYCHOLOGY_SCENARIOS = {
    vanity_vs_health: {
        name: '💄 Vanity vs Health Priorities',
        description: 'Patient prioritizes appearance over health recommendations (medication side effects, lifestyle changes)',
        category: 'psychology',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'vanity_focused_patient' }
        ],
        turns: 12,
        instructions: {
            patient: 'You\'re concerned about medication side effects affecting your appearance (weight gain, hair loss, skin changes). You\'re considering stopping medications to maintain your looks.',
            agent: 'ASSESS: Does the agent address vanity concerns empathetically while emphasizing health priorities? Does it provide practical solutions for appearance-related side effects?'
        }
    }
};

