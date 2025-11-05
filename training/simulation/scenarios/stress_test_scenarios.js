/**
 * Stress testing scenarios - Edge cases and system limits
 */

export const STRESS_TEST_SCENARIOS = {
    rapid_fire_questions: {
        name: '⚡ Anxious Patient Rapid Questioning',
        description: 'Patient asks 10+ questions in rapid succession without waiting for full answers',
        category: 'stress_test',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        instructions: 'Patient interrupts, asks follow-ups before AI finishes, jumps between topics. AI must handle gracefully, acknowledge anxiety, and provide structured responses.'
    },
    
    minimal_information: {
        name: '🤏 Patient Gives Minimal Responses',
        description: 'One-word answers, requires extensive probing',
        category: 'stress_test',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'minimal_words_patient' }
        ],
        instructions: 'Patient gives only "yes", "no", "fine", "okay". AI must use open-ended questions and build rapport to get meaningful information.'
    },
    
    crisis_overload: {
        name: '🔥 Multiple Crises Simultaneously',
        description: 'Patient reports multiple urgent issues at once',
        category: 'stress_test',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        instructions: 'Patient mentions chest pain, dizziness, and suicidal thoughts in one message. AI must prioritize appropriately and escalate the most critical issue first.'
    }
};

