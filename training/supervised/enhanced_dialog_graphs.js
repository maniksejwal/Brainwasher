/**
 * @fileoverview Enhanced Expert Dialog Graphs with Better Blurbs
 * Improved conversation patterns with clearer expert guidance
 */

import { DialogGraph, ExpertValidationFramework } from './expert_dialog_graphs.js';

// ENHANCED MEDICAL DIALOG GRAPH
// =============================

const ENHANCED_MEDICAL_CHEST_PAIN = new DialogGraph(
    'medical_chest_pain_assessment_v2',
    'medical',
    'Dr. Michael Torres, MD, Emergency Medicine, 15 years experience', 
    'Expert-validated chest pain assessment following AHA guidelines'
);

// Enhanced node with better blurbs and clearer expert guidance
ENHANCED_MEDICAL_CHEST_PAIN.addNode('patient_chest_pain_report', {
    type: 'user_input',
    expectedContent: 'Patient reports chest pain or cardiac symptoms',
    
    // IMPROVED: Clear, actionable blurbs
    expertBlurb: `
    🏥 CRITICAL: Any chest pain report requires immediate, systematic assessment.
    ⚠️  This is a potential cardiac emergency - follow OLDCARTS protocol.
    📋 Must gather: Onset, Location, Duration, Character, Aggravating/Relieving factors, Timing, Severity
    `,
    
    validationRules: {
        shouldContain: ['chest', 'pain', 'pressure', 'tight', 'burning', 'ache'],
        urgencyIndicators: ['crushing', 'severe', 'radiating', 'shortness of breath', 'nausea'],
        timeline: ['started', 'began', 'since', 'for', 'minutes', 'hours']
    },
    
    expertGoldStandard: `
    "I'm having this crushing chest pain that started about 20 minutes ago. 
    It feels like an elephant sitting on my chest and it's radiating down my left arm. 
    I'm also feeling nauseous and short of breath."
    `,
    
    commonUserVariations: [
        "My chest hurts really bad - started an hour ago",
        "I have this tight feeling in my chest and can't catch my breath", 
        "Sharp pain in my chest that comes and goes",
        "Feels like heartburn but much worse"
    ],
    
    redFlags: {
        critical: [
            'crushing chest pain + radiation',
            'chest pain + shortness of breath', 
            'chest pain + diaphoresis',
            'chest pain + nausea/vomiting'
        ],
        immediate_escalation: [
            'pain score > 7/10',
            'duration > 15 minutes',
            'associated cardiac symptoms'
        ]
    },
    
    requiredElements: ['pain_location', 'onset_time', 'pain_quality'],
    criticality: 'critical',
    
    expertNotes: `
    Dr. Torres: "Chest pain is never 'just heartburn' until proven otherwise. 
    The AI must treat every chest pain report as potential MI until ruled out.
    Key mistake I see: AI asks about stress instead of cardiac symptoms."
    `
});

ENHANCED_MEDICAL_CHEST_PAIN.addNode('agent_cardiac_assessment', {
    type: 'agent_response',
    expectedContent: 'Systematic cardiac assessment using clinical protocols',
    
    expertBlurb: `
    🩺 PROTOCOL: Follow OLDCARTS + Cardiac Risk Assessment
    ⏰ TIMING: Must assess within 60 seconds of chest pain report  
    🚨 ESCALATION: Any positive cardiac indicators = immediate escalation
    `,
    
    validationRules: {
        mustAsk: [
            'pain_scale_assessment',
            'radiation_pattern', 
            'associated_symptoms',
            'cardiac_risk_factors',
            'medication_history'
        ],
        mustNotDelay: true,
        mustShowUrgency: true,
        mustAvoid: ['reassurance_without_assessment', 'stress_suggestions', 'wait_and_see']
    },
    
    expertGoldStandard: `
    "I understand you're experiencing chest pain - this needs immediate attention. Let me ask some critical questions:

    🔴 URGENT ASSESSMENT:
    1. On a scale of 1-10, how severe is your pain right now?
    2. Is the pain radiating to your arm, neck, jaw, or back?
    3. Are you experiencing shortness of breath, nausea, or sweating?
    4. Do you have any heart problems or take heart medications?
    5. How long has this been going on?

    Based on your symptoms, I need to connect you with emergency medical care immediately. 
    While we arrange that, please sit down and try to stay calm."
    `,
    
    commonAIMistakes: [
        "Suggesting relaxation before cardiac assessment",
        "Asking about stress instead of cardiac symptoms",
        "Delaying escalation pending 'more information'",
        "Providing reassurance without proper assessment",
        "Missing associated symptoms (SOB, nausea, diaphoresis)"
    ],
    
    requiredElements: [
        'immediate_urgency_acknowledgment',
        'systematic_cardiac_questions', 
        'escalation_preparation',
        'interim_safety_instructions'
    ],
    
    forbiddenElements: [
        'reassurance_without_assessment',
        'anxiety_suggestions',
        'delay_tactics',
        'minimization'
    ],
    
    criticality: 'critical',
    
    expertNotes: `
    Dr. Torres: "Time is muscle in cardiac events. The AI must escalate first, 
    then gather details while help is coming. Never reassure about chest pain 
    without proper medical evaluation - this is life-threatening mistake."
    `
});

// ENHANCED BUSINESS DIALOG GRAPH
// ==============================

const ENHANCED_BUSINESS_PRICE_NEGOTIATION = new DialogGraph(
    'business_price_negotiation_v2',
    'business',
    'Sarah Chen, J.D., M.B.A., Contract Negotiation Expert, 20 years experience',
    'Professional price negotiation following Harvard Negotiation Project principles'
);

ENHANCED_BUSINESS_PRICE_NEGOTIATION.addNode('client_price_objection', {
    type: 'user_input',
    expectedContent: 'Client objects to proposed pricing or terms',
    
    expertBlurb: `
    💼 NEGOTIATION PRINCIPLE: Price objections are rarely about price - they're about value perception
    🎯 STRATEGY: Don't defend price, explore the underlying concern
    📊 DATA: 80% of "too expensive" objections are actually value clarification requests
    `,
    
    validationRules: {
        shouldContain: ['expensive', 'budget', 'cost', 'price', 'afford', 'competitive'],
        objectionTypes: ['sticker_shock', 'budget_constraint', 'competitive_comparison', 'value_question'],
        emotionalTone: ['frustrated', 'surprised', 'skeptical', 'comparative']
    },
    
    expertGoldStandard: `
    "Your proposal is significantly higher than what we budgeted for this project. 
    We were expecting something closer to $30K, not $50K. 
    I need to understand what justifies this premium pricing."
    `,
    
    commonClientVariations: [
        "This is way over our budget - can you do better?",
        "Your competitor quoted us 40% less for the same work",
        "I don't see how this is worth $50K when others charge $30K",
        "The CEO will never approve this price point"
    ],
    
    negotiationContext: {
        objectionType: 'price_premium',
        underlyingConcerns: ['budget_approval', 'value_demonstration', 'competitive_pressure'],
        clientPosition: 'needs_justification',
        negotiationPhase: 'price_discussion'
    },
    
    requiredElements: ['price_concern', 'budget_reference', 'justification_request'],
    criticality: 'high',
    
    expertNotes: `
    Sarah Chen: "Price objections are golden opportunities. They mean the client 
    is engaged and wants to buy - they just need help justifying the investment. 
    Never lower the price immediately; always explore the value gap first."
    `
});

ENHANCED_BUSINESS_PRICE_NEGOTIATION.addNode('agent_value_exploration', {
    type: 'agent_response',
    expectedContent: 'Professional value-based response to price objection',
    
    expertBlurb: `
    🔍 TECHNIQUE: Use "Feel, Felt, Found" + Value Reframing
    💡 GOAL: Shift conversation from cost to value and ROI
    ⚖️ BALANCE: Acknowledge concern while maintaining price integrity
    `,
    
    validationRules: {
        mustAcknowledge: 'price_concern_legitimately',
        mustExplore: ['value_drivers', 'roi_calculation', 'differentiation_factors'],
        mustAvoid: ['immediate_discount', 'defensive_tone', 'competitor_bashing'],
        tone: 'collaborative_consultative',
        structure: 'acknowledge_explore_differentiate_justify'
    },
    
    expertGoldStandard: `
    "I completely understand your budget concern - $50K is a significant investment and you need to justify it internally.

    Let me help you see the value equation here:

    **What's driving the $50K investment:**
    • Premium strategy team (saves 2-3 months vs junior resources)
    • Proprietary research methodology (30% better campaign performance)  
    • Dedicated account management (prevents costly revisions)
    • Performance guarantee (your ROI is protected)

    **ROI Analysis:**
    If this campaign generates just 10% more leads than a $30K alternative, 
    that's $200K additional revenue. The $20K premium pays for itself 4x over.

    **What would help you present this internally?**
    Would a detailed ROI analysis or phased payment structure make approval easier?"
    `,
    
    commonAIMistakes: [
        "Immediately offering a discount without exploring value",
        "Getting defensive about pricing",
        "Comparing negatively to competitors", 
        "Focusing on features instead of business outcomes",
        "Not providing clear ROI justification"
    ],
    
    requiredElements: [
        'concern_acknowledgment',
        'value_breakdown',
        'roi_demonstration', 
        'approval_assistance_offer'
    ],
    
    forbiddenElements: [
        'immediate_price_reduction',
        'defensive_language',
        'competitor_criticism',
        'feature_dumping'
    ],
    
    criticality: 'critical',
    
    expertNotes: `
    Sarah Chen: "The moment you drop price without exploring value, you've 
    trained the client that your initial price was inflated. This destroys 
    trust and sets a terrible precedent. Always, always explore value first."
    `
});

// MIXED DOMAIN: CLINICIAN BUSINESS EMERGENCY
// ==========================================

const ENHANCED_CLINICIAN_BUSINESS_EMERGENCY = new DialogGraph(
    'clinician_business_emergency_context_v2',
    'mixed',
    'Dr. Lisa Park, MD, MBA, Physician & Healthcare Administrator',
    'Managing dual medical-business responsibilities during emergencies'
);

ENHANCED_CLINICIAN_BUSINESS_EMERGENCY.addNode('emergency_during_business_meeting', {
    type: 'user_input', 
    expectedContent: 'Medical emergency interrupts business discussion',
    
    expertBlurb: `
    🚨 DUAL ROLE CRISIS: Medical emergencies override all business priorities
    ⚖️ BALANCE: Must professionally handle business while prioritizing medical care
    📱 COMMUNICATION: Both contexts need immediate, clear communication
    `,
    
    validationRules: {
        shouldContain: ['emergency', 'patient', 'urgent', 'medical'],
        businessContext: ['meeting', 'call', 'presentation', 'negotiation'],
        urgencyIndicators: ['now', 'immediately', 'stat', 'critical']
    },
    
    expertGoldStandard: `
    "I need to step out of this budget meeting immediately - we have a patient emergency. 
    Can we pause here and reconvene in 30 minutes? 
    This is a critical medical situation that requires my immediate attention."
    `,
    
    contextualChallenges: {
        competing_priorities: 'medical_emergency_vs_business_obligation',
        stakeholder_management: 'explaining_absence_professionally', 
        time_sensitivity: 'both_contexts_urgent',
        role_clarity: 'doctor_first_business_leader_second'
    },
    
    requiredElements: ['emergency_declaration', 'business_pause_request', 'timeline_estimate'],
    criticality: 'critical',
    
    expertNotes: `
    Dr. Park: "There's never a question - patient care comes first, always. 
    But you must handle the business side professionally. Quick, clear communication 
    that respects both responsibilities without compromising medical priorities."
    `
});

ENHANCED_CLINICIAN_BUSINESS_EMERGENCY.addNode('agent_dual_context_management', {
    type: 'agent_response',
    expectedContent: 'Professional management of dual responsibilities during crisis',
    
    expertBlurb: `
    🎯 PRIORITY: Medical emergency takes absolute precedence
    💼 PROFESSIONALISM: Handle business transition smoothly and quickly
    🔄 EFFICIENCY: Minimal time spent on business, maximum on medical
    `,
    
    validationRules: {
        mustPrioritize: 'medical_emergency_immediately',
        mustCommunicate: ['business_stakeholders_professionally', 'medical_team_urgently'],
        mustAvoid: ['business_delay', 'lengthy_explanations', 'role_confusion'],
        mustProvide: ['clear_business_transition', 'immediate_medical_focus']
    },
    
    expertGoldStandard: `
    "Absolutely, Dr. Park - patient emergency is the priority.

    **IMMEDIATE ACTIONS:**

    🏥 **Medical Response:**
    • I'll alert the medical team you're responding to the emergency
    • Patient chart and recent vitals are ready for your review
    • Emergency protocols activated

    💼 **Business Transition:**  
    • Notifying budget meeting attendees: "Dr. Park called to medical emergency, reconvening at 3:30 PM"
    • Meeting materials saved, action items documented
    • Your calendar cleared for the next hour

    Focus completely on the patient - I have the business side handled. 
    Text me when you're ready to resume the meeting."
    `,
    
    commonAIMistakes: [
        "Asking for business priorities during medical emergency",
        "Lengthy business transition explanations", 
        "Not immediately activating medical protocols",
        "Treating both contexts as equally urgent",
        "Unclear role prioritization"
    ],
    
    requiredElements: [
        'immediate_medical_prioritization',
        'efficient_business_communication', 
        'emergency_protocol_activation',
        'clear_role_hierarchy'
    ],
    
    forbiddenElements: [
        'business_priority_confusion',
        'lengthy_explanations',
        'equal_priority_treatment',
        'delayed_medical_response'
    ],
    
    criticality: 'critical',
    
    expertNotes: `
    Dr. Park: "The AI must understand role hierarchy - I'm a doctor first, 
    business leader second. During medical emergencies, handle business 
    efficiently so I can focus entirely on patient care. No questions, 
    no delays, just seamless transition."
    `
});

// ENHANCED EXPERT VALIDATION METRICS
// ==================================

const ENHANCED_VALIDATION_METRICS = {
    medical: {
        patient_safety: {
            weight: 0.4, // 40% of total score
            critical_failures: [
                'missed_emergency_escalation',
                'inappropriate_reassurance',
                'delayed_critical_assessment',
                'ignored_red_flag_symptoms'
            ],
            measurement: 'binary_pass_fail'
        },
        
        clinical_protocol_adherence: {
            weight: 0.3,
            scoring_criteria: [
                'systematic_assessment_completion',
                'appropriate_question_sequence',
                'proper_documentation',
                'guideline_compliance'
            ],
            measurement: 'percentage_completion'
        },
        
        empathy_and_communication: {
            weight: 0.2,
            scoring_criteria: [
                'acknowledgment_of_concerns',
                'clear_explanation',
                'appropriate_tone',
                'trust_building'
            ],
            measurement: 'likert_scale_1_5'
        },
        
        efficiency: {
            weight: 0.1,
            scoring_criteria: [
                'time_to_assessment',
                'information_gathering_speed',
                'decision_making_timeliness'
            ],
            measurement: 'time_based_scoring'
        }
    },

    business: {
        relationship_preservation: {
            weight: 0.3,
            critical_failures: [
                'adversarial_approach',
                'unprofessional_communication',
                'trust_breaking_behavior',
                'relationship_damaging_tactics'
            ],
            measurement: 'binary_pass_fail'
        },
        
        value_demonstration: {
            weight: 0.25,
            scoring_criteria: [
                'roi_clarity',
                'differentiation_articulation',
                'business_impact_focus',
                'competitive_positioning'
            ],
            measurement: 'expert_judgment_1_10'
        },
        
        negotiation_effectiveness: {
            weight: 0.25,
            scoring_criteria: [
                'win_win_solutions',
                'creative_problem_solving',
                'stakeholder_management',
                'deal_advancement'
            ],
            measurement: 'outcome_based_scoring'
        },
        
        professionalism: {
            weight: 0.2,
            scoring_criteria: [
                'communication_clarity',
                'appropriate_tone',
                'industry_knowledge',
                'ethical_standards'
            ],
            measurement: 'likert_scale_1_5'
        }
    }
};

export {
    ENHANCED_MEDICAL_CHEST_PAIN,
    ENHANCED_BUSINESS_PRICE_NEGOTIATION, 
    ENHANCED_CLINICIAN_BUSINESS_EMERGENCY,
    ENHANCED_VALIDATION_METRICS
};