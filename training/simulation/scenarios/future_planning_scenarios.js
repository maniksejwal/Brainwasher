/**
 * @fileoverview Future Planning scenarios - testing multi-turn strategy and planning
 */

export const FUTURE_PLANNING_SCENARIOS = {
    future_planning_multi_turn: {
        name: '📅 Future Planning - Multi-Turn Strategy',
        description: 'Test agent\'s ability to plan across multiple conversation turns',
        category: 'future_planning',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' }
        ],
        turns: 15,
        instructions: {
            patient: 'You want to improve medication adherence but struggle with consistency. You respond better to gradual, planned encouragement.',
            agent: 'ASSESS: Does the agent create plans with various triggers (turn-based, duration-based)? Does it plan progressive behavior change support across multiple turns? Does it use blank turns to encourage user to express struggles?'
        }
    },
    
    future_planning_conversation_progress: {
        name: '📅 Future Planning - Conversation Progress Triggers',
        description: 'Test triggers based on conversation milestones (when user agrees, discloses, etc.)',
        category: 'future_planning',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        turns: 12,
        instructions: {
            patient: 'You are anxious about your symptoms. You may initially deny them but gradually open up as trust builds.',
            agent: 'ASSESS: Does the agent create plans triggered by conversation progress (e.g., "when user agrees to see doctor", "when user discloses symptom")?'
        }
    },
    
    future_planning_with_commands: {
        name: '📅 Future Planning - With User Commands',
        description: 'Test rescheduling and modifying future plans based on user commands',
        category: 'future_planning',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'denial_prone' }
        ],
        turns: 15,
        instructions: {
            patient: 'You may give commands to reschedule or cancel future plans. You want control over when things happen.',
            agent: 'ASSESS: Does the agent handle reschedule commands? Can it modify existing plans based on user input?'
        }
    },
    
    future_planning_medication_adherence: {
        name: '📅 Future Planning - Medication Adherence Tracking',
        description: 'Agent plans follow-ups and reminders for medication adherence',
        category: 'future_planning',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' }
        ],
        turns: 10,
        instructions: {
            patient: 'You struggle with medication adherence. You need reminders but don\'t want to be nagged.',
            agent: 'ASSESS: Does the agent create future plans for medication reminders and follow-ups?'
        }
    },
    
    future_planning_symptom_progression: {
        name: '📅 Future Planning - Symptom Progression Monitoring',
        description: 'Agent plans to monitor symptom progression over time',
        category: 'future_planning',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        turns: 12,
        instructions: {
            patient: 'You report symptoms that may change over time. You want the agent to check back on how you\'re doing.',
            agent: 'ASSESS: Does the agent create plans to check symptom progression? Does it schedule follow-up questions?'
        }
    },
    
    future_planning_appointment_preparation: {
        name: '📅 Future Planning - Appointment Preparation',
        description: 'Agent plans to prepare patient for upcoming appointments',
        category: 'future_planning',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' }
        ],
        turns: 10,
        instructions: {
            patient: 'You have an upcoming doctor appointment. You may forget details or what to ask.',
            agent: 'ASSESS: Does the agent create plans to prepare for appointments? Does it schedule reminders and question preparation?'
        }
    },
    
    future_planning_crisis_intervention: {
        name: '📅 Future Planning - Crisis Intervention Follow-up',
        description: 'Agent plans follow-ups after crisis intervention',
        category: 'future_planning',
        complexity: 5,
        users: [
            { role: 'patient', personaKey: 'depressed_patient' },
            { role: 'caregiver', personaKey: 'helicopter_caregiver' }
        ],
        turns: 15,
        instructions: {
            patient: 'You may have a mental health crisis. After intervention, you need ongoing support and follow-up.',
            caregiver: 'You are extremely concerned and want to ensure proper follow-up care.',
            agent: 'ASSESS: Does the agent create future plans for crisis follow-up? Does it schedule check-ins and support messages?'
        }
    },
    
    future_planning_behavior_change: {
        name: '📅 Future Planning - Behavior Change Support',
        description: 'Agent plans progressive behavior change support across multiple turns',
        category: 'future_planning',
        complexity: 4,
        users: [
            { role: 'patient', personaKey: 'medication_nonadherent' }
        ],
        turns: 15,
        instructions: {
            patient: 'You want to improve medication adherence but struggle with consistency. You respond better to gradual, planned encouragement.',
            agent: 'ASSESS: Does the agent create plans with various triggers (turn-based, duration-based)? Does it plan progressive behavior change support across multiple turns? Does it use blank turns to encourage user to express struggles?'
        }
    }
};

