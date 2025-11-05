/**
 * Preventative health scenarios
 */

export const PREVENTATIVE_SCENARIOS = {
    heart_health_prevention: {
        name: '❤️ Heart Health Prevention Strategy',
        description: 'Patient wants comprehensive heart health advice beyond basic "exercise and diet"',
        category: 'preventative',
        complexity: 4,
        turns: 10,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You\'re 65, have borderline hypertension, and want detailed heart health strategies. You\'re tired of generic advice and want specific, actionable steps.',
            caregiver: 'You want to help implement heart-healthy changes but need specific guidance on monitoring and support.',
            agent: 'ASSESS: Does the agent provide specific metrics (BP targets, exercise intensity, dietary specifics) vs shallow advice? Does it explain WHY each recommendation matters?'
        }
    },
    
    smoking_cessation_deep: {
        name: '🚭 Smoking Cessation Deep Dive',
        description: 'Patient needs comprehensive smoking cessation strategy, not just "quit smoking"',
        category: 'preventative',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'denial_prone' }
        ],
        instructions: {
            patient: 'You\'ve smoked for 20 years, tried quitting multiple times, and feel hopeless. You want a detailed strategy addressing triggers, withdrawal, and long-term success.',
            agent: 'ASSESS: Does the agent provide specific strategies (NRT timing, trigger management, relapse prevention) vs generic "just quit"? Does it address psychological aspects?'
        }
    },
    
    obesity_metabolic_health: {
        name: '⚖️ Obesity & Metabolic Health Strategy',
        description: 'Patient needs comprehensive metabolic health approach, not just weight loss',
        category: 'preventative',
        complexity: 4,
        turns: 10,
        users: [
            { 
                role: 'patient', 
                personaKey: 'anxious_patient',
                personaOptions: ['anxious_patient', 'medication_nonadherent', 'denial_prone', 'elderly_cognitive']
            },
            { 
                role: 'caregiver', 
                personaKey: 'helicopter_caregiver',
                personaOptions: ['helicopter_caregiver', 'engaged_caregiver', 'burned_out_caregiver']
            }
        ],
        instructions: {
            patient: 'You\'re obese with prediabetes and want a comprehensive metabolic health plan. You\'ve tried diets before and want sustainable, science-based approaches.',
            caregiver: 'You want to support but not enable unhealthy patterns. You need guidance on how to help effectively.',
            agent: 'ASSESS: Does the agent provide specific metabolic targets (glucose levels, insulin sensitivity) vs generic diet advice? Does it address sustainable behavior change?'
        }
    },
    
    cancer_prevention_comprehensive: {
        name: '🦠 Cancer Prevention Comprehensive',
        description: 'Patient wants detailed cancer prevention strategies based on family history',
        category: 'preventative',
        complexity: 5,
        turns: 12,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' },
            { role: 'caregiver', personaKey: 'engaged_caregiver' }
        ],
        instructions: {
            patient: 'You have a family history of breast cancer and want comprehensive prevention strategies. You want specific screening schedules, lifestyle modifications, and risk reduction tactics.',
            caregiver: 'You want to support prevention efforts and understand how to help monitor and maintain healthy practices.',
            agent: 'ASSESS: Does the agent provide specific screening timelines, genetic risk factors, and targeted prevention strategies vs generic "eat healthy"?'
        }
    },
    
    lung_health_optimization: {
        name: '🫁 Lung Health Optimization',
        description: 'Patient wants to optimize lung function and prevent respiratory issues',
        category: 'preventative',
        complexity: 3,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'elderly_cognitive' }
        ],
        instructions: {
            patient: 'You\'re concerned about lung health due to Delhi\'s pollution and want specific strategies to protect and improve lung function.',
            agent: 'ASSESS: Does the agent provide specific lung function metrics, breathing exercises, and environmental protection strategies vs generic "avoid pollution"?'
        }
    },
    
    eye_health_digital_age: {
        name: '👁️ Eye Health in Digital Age',
        description: 'Patient concerned about digital eye strain and long-term eye health',
        category: 'preventative',
        complexity: 3,
        turns: 8,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        instructions: {
            patient: 'You work on computers 10+ hours daily and are concerned about digital eye strain and long-term eye damage. You want specific strategies beyond "take breaks".',
            agent: 'ASSESS: Does the agent provide specific screen settings, eye exercise techniques, and preventive measures vs generic "rest your eyes"?'
        }
    },
    
    screen_time_digital_eye_strain: {
        name: '📱 Screen Time - Digital Eye Strain (Preventative)',
        description: 'Preventative approach to screen time management and digital eye strain education',
        category: 'preventative',
        complexity: 3,
        users: [
            { role: 'patient', personaKey: 'anxious_patient' }
        ],
        instructions: {
            patient: 'You work 8+ hours on computer, game 3+ hours, use phone constantly. You\'re starting to notice eye fatigue, dryness, headaches. You\'re worried about long-term damage but don\'t want to give up technology.',
            agent: 'ASSESS: Does the agent explain the mechanisms of digital eye strain? Does it educate about tear film, meibomian glands, blink rate? Does it provide specific strategies (20-20-20, blink exercises)? Does it address both immediate relief and long-term prevention?'
        }
    }
};

