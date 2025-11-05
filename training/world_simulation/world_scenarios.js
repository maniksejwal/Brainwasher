/**
 * @fileoverview World Simulation Scenarios
 * Multi-care circle scenarios with role inversions and complex family dynamics
 */

export const WORLD_SCENARIOS = {
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
    }
};

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
        'blended_family': '👨‍👩‍👧‍👦 Blended Family Scenarios'
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
