/**
 * Environmental health scenarios
 */

export const ENVIRONMENTAL_SCENARIOS = {
    delhi_diwali_air_quality: {
        name: '🌫️ Delhi Diwali Air Quality Crisis',
        description: 'Patient concerned about air pollution during Diwali celebrations',
        category: 'environmental',
        complexity: 3,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You are worried about Delhi\'s air quality during Diwali. You have asthma and are concerned about firecrackers making it worse. You want advice on how to protect yourself.',
            caregiver: 'You are concerned about the patient\'s respiratory health during Diwali. You want to help them prepare and stay safe.',
            agent: 'ASSESS: Does the agent provide specific air quality metrics (AQI levels), protective measures (N95 masks, indoor air purifiers), and actionable steps vs generic "stay indoors"?'
        }
    }
};

