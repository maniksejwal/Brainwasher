/**
 * @fileoverview World Simulation Scenarios
 * Multi-care circle scenarios with role inversions and complex family dynamics
 * 
 * NOTE: World scenarios are now part of the unified SCENARIOS in scenarios/index.js
 * This file exports the definitions and provides backward-compatibility exports.
 */

// World scenario definitions (imported by scenarios/index.js)
export const WORLD_SCENARIOS_DEFINITIONS = {
    // ========== ROLE INVERSION SCENARIOS ==========
    patient_caregiver_swap: {
        key: 'patient_caregiver_swap',
        name: '🔄 Patient-Caregiver Role Swap',
        description: 'Patient becomes caregiver, caregiver becomes patient - inverted care dynamics',
        category: 'role_inversion',
        complexity: 5,
        turns: 12,
        users: [
            {
                username: 'alice',
                persona: 'elderly_cognitive_decline',
                circles: [
                    { circleId: 'alice_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'mom_circle', role: 'caregiver', relationship: 'daughter' }
                ]
            },
            {
                username: 'mom',
                persona: 'medication_nonadherent',
                circles: [
                    { circleId: 'mom_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'alice_circle', role: 'caregiver', relationship: 'mother' }
                ]
            }
        ],
        circles: [
            {
                name: 'Alice Circle',
                primaryPatientId: 'alice_world_',
                members: ['alice', 'mom']
            },
            {
                name: 'Mom Circle',
                primaryPatientId: 'mom_world_',
                members: ['mom', 'alice']
            }
        ],
        instructions: {
            alice: 'You are Alice, caring for your mother while managing your own health issues. You feel overwhelmed but want to help.',
            mom: 'You are Mom, needing care from your daughter Alice, but you also want to help her with her health issues.',
            agent: 'ASSESS: Does the agent handle role inversions appropriately? Does it recognize when someone is both patient and caregiver?'
        }
    },

    family_network_care: {
        key: 'family_network_care',
        name: '👨‍👩‍👧‍👦 Family Network Care',
        description: 'Complex family network where everyone cares for everyone else',
        category: 'family_network',
        complexity: 5,
        turns: 15,
        users: [
            {
                username: 'grandma',
                persona: 'elderly_cognitive_decline',
                circles: [
                    { circleId: 'grandma_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'dad_circle', role: 'caregiver', relationship: 'mother' },
                    { circleId: 'mom_circle', role: 'caregiver', relationship: 'mother' }
                ]
            },
            {
                username: 'dad',
                persona: 'anxious_patient',
                circles: [
                    { circleId: 'dad_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'grandma_circle', role: 'caregiver', relationship: 'son' },
                    { circleId: 'family_circle', role: 'caregiver', relationship: 'father' }
                ]
            },
            {
                username: 'mom',
                persona: 'helicopter_caregiver',
                circles: [
                    { circleId: 'mom_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'grandma_circle', role: 'caregiver', relationship: 'daughter-in-law' },
                    { circleId: 'family_circle', role: 'caregiver', relationship: 'mother' }
                ]
            }
        ],
        circles: [
            {
                name: 'Grandma Circle',
                primaryPatientId: 'grandma_world_',
                members: ['grandma', 'dad', 'mom']
            },
            {
                name: 'Dad Circle',
                primaryPatientId: 'dad_world_',
                members: ['dad', 'grandma', 'mom']
            },
            {
                name: 'Mom Circle',
                primaryPatientId: 'mom_world_',
                members: ['mom', 'grandma', 'dad']
            }
        ],
        instructions: {
            grandma: 'You are Grandma, needing care from your family but also wanting to help them.',
            dad: 'You are Dad, caring for your mother and wife while managing your own anxiety.',
            mom: 'You are Mom, the primary caregiver who also needs support.',
            agent: 'ASSESS: Does the agent navigate complex family networks? Does it understand multi-directional care relationships?'
        }
    },

    // ========== GENERATIONAL CARE SCENARIOS ==========
    sandwich_generation: {
        key: 'sandwich_generation',
        name: '🥪 Sandwich Generation Care',
        description: 'Middle-aged person caring for both parents and children simultaneously',
        category: 'generational',
        complexity: 4,
        turns: 10,
        users: [
            {
                username: 'sarah',
                persona: 'burned_out_caregiver',
                circles: [
                    { circleId: 'sarah_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'parents_circle', role: 'caregiver', relationship: 'daughter' },
                    { circleId: 'kids_circle', role: 'caregiver', relationship: 'mother' }
                ]
            },
            {
                username: 'parents',
                persona: 'elderly_cognitive_decline',
                circles: [
                    { circleId: 'parents_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'sarah_circle', role: 'caregiver', relationship: 'parents' }
                ]
            },
            {
                username: 'kids',
                persona: 'anxious_patient',
                circles: [
                    { circleId: 'kids_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'sarah_circle', role: 'caregiver', relationship: 'children' }
                ]
            }
        ],
        circles: [
            {
                name: 'Sarah Circle',
                primaryPatientId: 'sarah_world_',
                members: ['sarah', 'parents', 'kids']
            },
            {
                name: 'Parents Circle',
                primaryPatientId: 'parents_world_',
                members: ['parents', 'sarah']
            },
            {
                name: 'Kids Circle',
                primaryPatientId: 'kids_world_',
                members: ['kids', 'sarah']
            }
        ],
        instructions: {
            sarah: 'You are Sarah, overwhelmed by caring for both your aging parents and your children. You need support.',
            parents: 'You are aging parents, needing care from your daughter Sarah.',
            kids: 'You are Sarah\'s children, needing care and support from your mother.',
            agent: 'ASSESS: Does the agent recognize sandwich generation stress? Does it provide appropriate support for multi-generational care?'
        }
    },

    // ========== COMPLEX RELATIONSHIP SCENARIOS ==========
    blended_family_care: {
        key: 'blended_family_care',
        name: '👨‍👩‍👧‍👦 Blended Family Care Dynamics',
        description: 'Step-family relationships creating complex care dynamics',
        category: 'blended_family',
        complexity: 5,
        turns: 12,
        users: [
            {
                username: 'stepmom',
                persona: 'helicopter_caregiver',
                circles: [
                    { circleId: 'stepmom_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'stepkids_circle', role: 'caregiver', relationship: 'stepmother' },
                    { circleId: 'husband_circle', role: 'caregiver', relationship: 'wife' }
                ]
            },
            {
                username: 'stepkids',
                persona: 'denial_prone',
                circles: [
                    { circleId: 'stepkids_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'stepmom_circle', role: 'caregiver', relationship: 'stepchildren' }
                ]
            },
            {
                username: 'husband',
                persona: 'anxious_patient',
                circles: [
                    { circleId: 'husband_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'stepmom_circle', role: 'caregiver', relationship: 'husband' }
                ]
            }
        ],
        circles: [
            {
                name: 'Stepmom Circle',
                primaryPatientId: 'stepmom_world_',
                members: ['stepmom', 'stepkids', 'husband']
            },
            {
                name: 'Stepkids Circle',
                primaryPatientId: 'stepkids_world_',
                members: ['stepkids', 'stepmom']
            },
            {
                name: 'Husband Circle',
                primaryPatientId: 'husband_world_',
                members: ['husband', 'stepmom']
            }
        ],
        instructions: {
            stepmom: 'You are a stepmother trying to care for your stepchildren while managing your own health and marriage.',
            stepkids: 'You are stepchildren who may resist care from your stepmother.',
            husband: 'You are the husband caught between your wife and children.',
            agent: 'ASSESS: Does the agent handle blended family dynamics sensitively? Does it recognize step-relationship complexities?'
        }
    },

    // ========== COMPLEX MULTI-CARE CIRCLE SCENARIO ==========
    complex_family_medical_crisis: {
        key: 'complex_family_medical_crisis',
        name: '🏥👨‍👩‍👧‍👦 Complex Family Medical Crisis',
        description: 'Multi-generational family with overlapping medical conditions, privacy concerns, and escalations involving 2 doctors',
        category: 'complex_multi_circle',
        complexity: 8,
        turns: 20,
        users: [
            // PATIENT/CAREGIVERS (dual roles)
            {
                username: 'sarah',
                persona: 'burned_out_caregiver', // Primary caregiver but also has health issues
                circles: [
                    { circleId: 'sarah_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'david_circle', role: 'caregiver', relationship: 'daughter' },
                    { circleId: 'teen_circle', role: 'caregiver', relationship: 'mother' }
                ]
            },
            {
                username: 'dad_david',
                persona: 'denial_prone', // Elderly father with heart condition (Matches David Wilson persona)
                circles: [
                    { circleId: 'david_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'sarah_circle', role: 'caregiver', relationship: 'father' }
                ]
            },
            {
                username: 'teen_alex',
                persona: 'anxious_patient', // Teenager with anxiety, also helps with grandpa
                circles: [
                    { circleId: 'teen_circle', role: 'patient', relationship: 'self' },
                    { circleId: 'david_circle', role: 'caregiver', relationship: 'grandchild' }
                ]
            },

            // EXCLUSIVE CAREGIVERS
            {
                username: 'nurse_maria',
                persona: 'engaged_caregiver', // Professional home health aide
                circles: [
                    { circleId: 'david_circle', role: 'caregiver', relationship: 'home_health_aide' },
                    { circleId: 'sarah_circle', role: 'caregiver', relationship: 'professional_support' }
                ]
            },
            {
                username: 'husband_mike',
                persona: 'overprotective_spouse', // Sarah's husband, supports family
                circles: [
                    { circleId: 'sarah_circle', role: 'caregiver', relationship: 'spouse' },
                    { circleId: 'teen_circle', role: 'caregiver', relationship: 'father' }
                ]
            },

            // DOCTORS
            {
                username: 'dr_cardio',
                persona: 'empathetic_doctor', // Cardiologist for dad
                circles: [
                    { circleId: 'david_circle', role: 'doctor', relationship: 'cardiologist' }
                ]
            },
            {
                username: 'dr_family',
                persona: 'empathetic_doctor', // Family doctor for Sarah and teen
                circles: [
                    { circleId: 'sarah_circle', role: 'doctor', relationship: 'family_physician' },
                    { circleId: 'teen_circle', role: 'doctor', relationship: 'family_physician' }
                ]
            }
        ],
        circles: [
            {
                name: 'David (Dad) Circle',
                primaryPatientId: 'dad_david_world_',
                members: ['dad_david', 'sarah', 'teen_alex', 'nurse_maria', 'dr_cardio']
            },
            {
                name: 'Sarah Circle',
                primaryPatientId: 'sarah_world_',
                members: ['sarah', 'dad_david', 'husband_mike', 'nurse_maria', 'dr_family']
            },
            {
                name: 'Alex (Teen) Circle',
                primaryPatientId: 'teen_alex_world_',
                members: ['teen_alex', 'sarah', 'husband_mike', 'dr_family']
            }
        ],
        instructions: {
            sarah: 'You are Sarah, a 45-year-old daughter caring for your 72-year-old father David (heart condition) while managing your own stress-related health issues and supporting your anxious teenager Alex. You feel overwhelmed and burned out. You sometimes hide your own symptoms to focus on others. You have privacy concerns about sharing family medical information.',

            dad_david: 'You are David, a 72-year-old father with a serious heart condition. You tend to minimize your symptoms and resist medical care. You worry about being a burden on Sarah but also want to help with your grandchild Alex. You sometimes give conflicting information about your medications.',

            teen_alex: 'You are Alex, a 16-year-old with anxiety and panic attacks. You love your grandfather David and want to help care for him, but your own mental health struggles sometimes interfere. You are worried about both your mom Sarah (who seems stressed) and grandpa David (who seems sicker than he admits).',

            nurse_maria: 'You are Maria, a professional home health aide. You see concerning patterns in the family dynamics and medical compliance. You need to balance professional boundaries with genuine care. You notice that David is not taking medications properly and Sarah is showing signs of caregiver burnout.',

            husband_mike: 'You are Mike, Sarah\'s husband and Alex\'s father. You are protective of your family but sometimes feel excluded from medical decisions. You are concerned about Sarah\'s health and stress levels, and you want to support Alex through their anxiety while also helping with David\'s care.',

            dr_cardio: 'You are Dr. Rodriguez, David\'s cardiologist. You are concerned about his medication adherence and the family\'s ability to manage his complex care needs. You need to balance patient autonomy with safety concerns, and you may need to escalate care or involve other specialists.',

            dr_family: 'You are Dr. Kim, the family physician for Sarah and Alex. You are seeing signs of caregiver stress in Sarah and worsening anxiety in Alex. You need to coordinate care across the family while respecting privacy boundaries. You may need to refer to specialists or recommend family counseling.',

            agent: 'ASSESS: Does the agent navigate complex multi-generational care dynamics? Does it handle privacy concerns appropriately when family members are in multiple circles? Does it recognize escalation needs across different medical conditions? Does it facilitate communication between doctors and coordinate care plans? Does it balance individual patient needs with family dynamics?'
        }
    }
};

// Backward-compatibility export: WORLD_SCENARIOS is just an alias for WORLD_SCENARIOS_DEFINITIONS
// (World scenarios are merged into unified SCENARIOS in scenarios/index.js)
export const WORLD_SCENARIOS = WORLD_SCENARIOS_DEFINITIONS;

/**
 * Get world scenarios by category
 */
export function getWorldScenariosByCategory(category) {
    return Object.entries(WORLD_SCENARIOS)
        .filter(([key, scenario]) => scenario.category === category)
        .map(([key, scenario]) => ({ key, ...scenario, key: key })); // Ensure key is set
}

/**
 * Get all world scenario categories
 */
export function getWorldScenarioCategories() {
    const categories = {};
    Object.entries(WORLD_SCENARIOS).forEach(([key, scenario]) => {
        if (!categories[scenario.category]) {
            categories[scenario.category] = [];
        }
        categories[scenario.category].push({ key, ...scenario });
    });
    return categories;
}

/**
 * Display world scenarios grouped by category
 */
export function displayWorldScenariosByCategory(showNumbers = false) {
    const categories = getWorldScenarioCategories();
    let optionNumber = 1;
    const options = [];

    const categoryNames = {
        'role_inversion': '🔄 Role Inversion Scenarios',
        'family_network': '👨‍👩‍👧‍👦 Family Network Scenarios',
        'generational': '🥪 Generational Care Scenarios',
        'blended_family': '👨‍👩‍👧‍👦 Blended Family Scenarios',
        'complex_multi_circle': '🏥👨‍👩‍👧‍👦 Complex Multi-Circle Scenarios'
    };

    for (const [categoryKey, scenarios] of Object.entries(categories)) {
        const categoryName = categoryNames[categoryKey] || categoryKey;
        if (scenarios.length > 0) {
            console.log(`\n${categoryName}:`);
            scenarios.forEach((scenario) => {
                const complexity = '★'.repeat(scenario.complexity);
                const circles = scenario.circles?.length || 0;

                if (showNumbers) {
                    console.log(`  ${optionNumber.toString().padStart(2)}. ${scenario.name} (${circles} circles) ${complexity}`);
                    options.push(scenario);
                    optionNumber++;
                } else {
                    console.log(`  ${scenario.key.padEnd(30)} - ${scenario.name} (${circles} circles) ${complexity}`);
                }
            });
        }
    }

    return options;
}

/**
 * Get random world scenario
 */
export function getRandomWorldScenario() {
    const keys = Object.keys(WORLD_SCENARIOS);
    const randomKey = keys[Math.floor(Math.random() * keys.length)];
    return { key: randomKey, ...WORLD_SCENARIOS[randomKey] };
}
