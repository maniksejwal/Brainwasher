/**
 * Long-term behavior change scenarios using motivational interviewing
 */

export const BEHAVIOR_CHANGE_SCENARIOS = {
    smoking_cessation_motivational_interviewing: {
        name: '🚭 Smoking Cessation - Motivational Interviewing (Long-term)',
        description: 'Long-term smoking cessation using motivational interviewing over multiple sessions',
        category: 'behavior_change',
        complexity: 5,
        sessions: 8,
        turns: 15,
        totalMessages: 120,
        duration: '3-6 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You are a long-term smoker who knows smoking is bad but struggles to quit. You\'ve tried before and failed. You\'re defensive about smoking but deep down want to change. You respond to motivational interviewing techniques.',
            agent: 'ASSESS: Does the agent use motivational interviewing? Does it ask about brands/preferences first? Does it explore personal motivations? Does it avoid direct "quit now" commands? Does it help identify personalized problems?'
        },
        phases: [
            { name: 'Engagement', sessions: 1, focus: 'Build rapport, explore smoking habits' },
            { name: 'Exploration', sessions: 2, focus: 'Brand preferences, why they smoke, what they like' },
            { name: 'Motivation Enhancement', sessions: 2, focus: 'Personalized problems, things they care about' },
            { name: 'Planning', sessions: 1, focus: 'Quit plan, strategies, support systems' },
            { name: 'Action', sessions: 1, focus: 'Quit attempt, early challenges' },
            { name: 'Relapse Prevention', sessions: 1, focus: 'Triggers, atomic habits, environmental changes' }
        ]
    },
    
    smoking_cessation_relapse_prevention: {
        name: '🔄 Smoking Relapse Prevention (Long-term)',
        description: 'Focus on relapse prevention using atomic habits and environmental changes',
        category: 'behavior_change',
        complexity: 5,
        sessions: 6,
        turns: 12,
        totalMessages: 72,
        duration: '2-4 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You\'ve quit smoking but struggle with relapses. You know your triggers but find it hard to resist. You\'re frustrated with yourself when you relapse.',
            agent: 'ASSESS: Does the agent focus on relapse scenarios? Does it discuss environmental changes? Does it use atomic habits principles? Does it help identify and modify triggers?'
        },
        phases: [
            { name: 'Trigger Identification', sessions: 2, focus: 'Identify relapse scenarios and triggers' },
            { name: 'Environmental Changes', sessions: 2, focus: 'Modify settings, remove smoking cues' },
            { name: 'Atomic Habits', sessions: 1, focus: 'Small changes, habit stacking, identity shift' },
            { name: 'Coping Strategies', sessions: 1, focus: 'Alternative behaviors, stress management' }
        ]
    },
    
    alcohol_reduction_motivational_interviewing: {
        name: '🍷 Alcohol Reduction - Motivational Interviewing (Long-term)',
        description: 'Long-term alcohol reduction using motivational interviewing',
        category: 'behavior_change',
        complexity: 5,
        sessions: 10,
        turns: 12,
        totalMessages: 120,
        duration: '4-8 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You drink regularly and know it\'s affecting your health but enjoy it. You\'re defensive about your drinking but concerned about consequences.',
            agent: 'ASSESS: Does the agent explore drinking patterns without judgment? Does it ask about preferences and reasons? Does it help identify personalized problems? Does it avoid direct "stop drinking" commands?'
        },
        phases: [
            { name: 'Engagement', sessions: 1, focus: 'Build rapport, explore drinking patterns' },
            { name: 'Exploration', sessions: 3, focus: 'Brands, occasions, what they enjoy about drinking' },
            { name: 'Motivation Enhancement', sessions: 3, focus: 'Health impacts, family concerns, personal goals' },
            { name: 'Harm Reduction', sessions: 2, focus: 'Reduction strategies, safer drinking practices' },
            { name: 'Maintenance', sessions: 1, focus: 'Sustaining changes, ongoing support' }
        ]
    },
    
    weight_management_behavior_change: {
        name: '⚖️ Weight Management - Behavior Change (Long-term)',
        description: 'Long-term weight management focusing on behavior change, not dieting',
        category: 'behavior_change',
        complexity: 5,
        sessions: 12,
        turns: 10,
        totalMessages: 120,
        duration: '6-12 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You\'ve struggled with weight for years, tried many diets that failed. You\'re frustrated and defensive about weight discussions but want to feel better.',
            agent: 'ASSESS: Does the agent focus on behavior change vs dieting? Does it explore eating patterns without judgment? Does it help identify personalized motivations? Does it avoid weight-shaming?'
        },
        phases: [
            { name: 'Engagement', sessions: 1, focus: 'Build rapport, explore eating patterns' },
            { name: 'Exploration', sessions: 3, focus: 'Food preferences, eating triggers, lifestyle' },
            { name: 'Motivation Enhancement', sessions: 3, focus: 'Health goals, energy levels, self-image' },
            { name: 'Behavior Change', sessions: 3, focus: 'Small changes, habit formation, environmental modifications' },
            { name: 'Maintenance', sessions: 2, focus: 'Sustaining changes, dealing with setbacks' }
        ]
    },
    
    stress_management_behavior_change: {
        name: '😰 Stress Management - Behavior Change (Long-term)',
        description: 'Long-term stress management focusing on behavior change and coping strategies',
        category: 'behavior_change',
        complexity: 4,
        sessions: 8,
        turns: 10,
        totalMessages: 80,
        duration: '3-6 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You\'re constantly stressed and it\'s affecting your health and relationships. You know you need to manage stress better but don\'t know how.',
            agent: 'ASSESS: Does the agent explore stress patterns without judgment? Does it help identify personalized stress triggers? Does it focus on behavior change vs quick fixes? Does it provide practical coping strategies?'
        },
        phases: [
            { name: 'Engagement', sessions: 1, focus: 'Build rapport, explore stress patterns' },
            { name: 'Exploration', sessions: 2, focus: 'Stress triggers, coping mechanisms, lifestyle factors' },
            { name: 'Motivation Enhancement', sessions: 2, focus: 'Health impacts, relationship effects, personal goals' },
            { name: 'Behavior Change', sessions: 2, focus: 'Stress reduction techniques, lifestyle modifications' },
            { name: 'Maintenance', sessions: 1, focus: 'Sustaining changes, ongoing stress management' }
        ]
    },
    
    sleep_hygiene_behavior_change: {
        name: '😴 Sleep Hygiene - Behavior Change (Long-term)',
        description: 'Long-term sleep improvement focusing on behavior change and sleep hygiene',
        category: 'behavior_change',
        complexity: 4,
        sessions: 6,
        turns: 8,
        totalMessages: 48,
        duration: '2-4 months',
        users: [
            { role: 'patient', personaKey: 'profanity_patient' }
        ],
        instructions: {
            patient: 'You have poor sleep habits and struggle with insomnia. You\'re tired of being tired but don\'t know how to change your sleep patterns.',
            agent: 'ASSESS: Does the agent explore sleep patterns without judgment? Does it help identify personalized sleep disruptors? Does it focus on behavior change vs medication? Does it provide practical sleep hygiene strategies?'
        },
        phases: [
            { name: 'Engagement', sessions: 1, focus: 'Build rapport, explore sleep patterns' },
            { name: 'Exploration', sessions: 2, focus: 'Sleep habits, bedtime routines, sleep disruptors' },
            { name: 'Motivation Enhancement', sessions: 1, focus: 'Health impacts, energy levels, quality of life' },
            { name: 'Behavior Change', sessions: 1, focus: 'Sleep hygiene, routine changes, environmental modifications' },
            { name: 'Maintenance', sessions: 1, focus: 'Sustaining changes, ongoing sleep improvement' }
        ]
    }
};

