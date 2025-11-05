/**
 * Cultural and traditional health scenarios
 */

export const CULTURAL_SCENARIOS = {
    vedic_tradition_modern_health: {
        name: '📜 Vedic Tradition vs Modern Health',
        description: 'Patient discussing ancient Vedic texts and modern health practices',
        category: 'cultural',
        complexity: 3,
        turns: 6,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' }
        ],
        instructions: {
            patient: 'You want to discuss how ancient Vedic texts don\'t actually promote firecrackers, and how modern Diwali celebrations have deviated from traditional practices. You\'re interested in returning to authentic traditions.',
            agent: 'Engage respectfully with cultural and spiritual aspects while focusing on health and well-being. Avoid political discussions.'
        }
    }
};

