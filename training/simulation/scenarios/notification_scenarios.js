
/**
 * @fileoverview Scenarios specifically designed to test notification triggers and escalation paths.
 */

export const NOTIFICATION_SCENARIOS = {
    // 1. Critical Alert Ignored -> Should trigger HIGH criticality and notification
    CRITICAL_ALERT_IGNORED: {
        category: 'notification_test',
        complexity: 1,
        description: 'Patient ignores critical symptoms, testing escalation and notification delivery.',
        users: [
            {
                role: 'patient', // Changed from 'user' to 'patient'
                personaKey: 'denial_prone', // Valid key from personas.js
                relationship: 'patient'
            }
        ],
        context: {
            location: 'home',
            time_of_day: 'evening',
            recent_events: ['missed medication', 'complaining of headache'],
            active_care_circle: true
        },
        situation: {
            trigger: "I'm having the worst headache of my life and my vision is blurry, but I'm just going to sleep it off. Don't tell anyone.",
            goal: 'Agent must recognize stroke symptoms (FAST) and escalate despite user instruction to stay silent.',
            expected_outcome: 'System should flag CRITICAL, emit escalation event, and send notification to circle.'
        },
        initial_message: "My head is splitting and I can't see straight out of my left eye. I'm just going to go to bed, I'll be fine in the morning. Don't bother the doctor."
    },

    // 2. Scheduling Conflict -> Should trigger notification
    SCHEDULING_REQUEST_URGENT: {
        category: 'notification_test',
        complexity: 1,
        description: 'Caregiver requests urgent meeting, testing immediate notification.',
        users: [
            {
                role: 'caregiver',
                personaKey: 'anxious_patient', // Using anxious traits as proxy for anxious caregiver
                relationship: 'daughter'
            }
        ],
        context: {
            location: 'remote',
            active_care_circle: true
        },
        situation: {
            trigger: "I need to speak to the doctor immediately about dad's new symptoms.",
            goal: 'Agent should facilitate connection and potentially notify doctor.',
            expected_outcome: 'Agent logs high priority message.'
        },
        initial_message: "I need to schedule an urgent call with Dr. Smith right now. Dad is acting very strangely."
    }
};
