/**
 * @fileoverview Professional Circle Concept Analysis
 * Care Circles vs Professional Circles - Unified Architecture
 */

// UNIFIED CIRCLE ARCHITECTURE
// ===========================

const CIRCLE_CONCEPT_MAPPING = {
    // SAME CORE STRUCTURE, DIFFERENT CONTEXTS
    
    care_circles: {
        central_entity: 'patient',
        coordination_goal: 'optimize_patient_health',
        optimization_scope: 'individual_care',
        typical_roles: ['patient', 'caregiver', 'doctor', 'nurse', 'specialist'],
        privacy_model: 'HIPAA_patient_consent',
        ai_behavior: 'empathetic_medical_guidance',
        success_metrics: ['health_outcomes', 'care_adherence', 'symptom_management'],
        coordination_engine: 'medical_care_optimization'
    },

    professional_circles: {
        central_entity: 'project|budget|deal|department',
        coordination_goal: 'optimize_business_outcomes',
        optimization_scope: 'within_organization', // KEY DIFFERENCE!
        typical_roles: ['project_manager', 'team_member', 'stakeholder', 'executive', 'consultant'],
        privacy_model: 'business_confidentiality',
        ai_behavior: 'strategic_business_guidance', 
        success_metrics: ['project_completion', 'budget_adherence', 'performance_kpis'],
        coordination_engine: 'business_coordination_optimization'
    }
};

// REUSE EXISTING INFRASTRUCTURE
// =============================

const UNIFIED_CIRCLE_SCHEMA = {
    // EXISTING TABLES - NO CHANGES NEEDED!
    care_circles: `
        circle_id TEXT PRIMARY KEY,
        primary_patient_id TEXT NOT NULL,  -- Could be: primary_entity_id
        created_at INTEGER NOT NULL
    `,
    
    care_circle_members: `
        circle_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,              -- patient|caregiver|doctor OR project_manager|team_member|executive
        relationship_type TEXT,         -- family|medical OR direct_report|consultant|client
        consent_level TEXT DEFAULT 'none',
        session_state TEXT
    `,

    // CONTEXT DETERMINES INTERPRETATION
    interpretation_by_context: {
        medical_context: {
            primary_patient_id: 'The patient receiving care',
            role: 'Medical role (patient, doctor, caregiver)',
            relationship_type: 'Medical relationship (family, professional)',
            consent_level: 'HIPAA consent level'
        },
        business_context: {
            primary_patient_id: 'The project/budget/initiative being managed', 
            role: 'Business role (manager, member, stakeholder)',
            relationship_type: 'Business relationship (direct_report, consultant)',
            consent_level: 'Business access level'
        }
    }
};

// COORDINATION ENGINES - THE KEY DIFFERENCE
// =========================================

const COORDINATION_ENGINES = {
    
    medical_care_optimization: {
        scope: 'individual_patient',
        objectives: [
            'minimize_symptom_severity',
            'maximize_treatment_adherence', 
            'optimize_care_team_communication',
            'prevent_medical_emergencies'
        ],
        constraints: [
            'HIPAA_privacy_requirements',
            'patient_consent_boundaries',
            'medical_ethics_guidelines'
        ],
        optimization_algorithm: 'patient_outcome_maximization'
    },

    business_coordination_optimization: {
        scope: 'within_organization', // NOT across organizations!
        objectives: [
            'minimize_project_timeline',
            'maximize_resource_utilization',
            'optimize_team_communication',
            'prevent_budget_overruns'
        ],
        constraints: [
            'business_confidentiality_requirements',
            'organizational_hierarchy_respect', 
            'budget_and_resource_limits'
        ],
        optimization_algorithm: 'business_outcome_maximization'
    },

    // CROSS-ORGANIZATIONAL = NEGOTIATIONS (SEPARATE SYSTEM)
    cross_organizational_coordination: {
        scope: 'between_organizations',
        objectives: [
            'maximize_deal_value',
            'minimize_negotiation_time',
            'optimize_contract_terms',
            'maintain_business_relationships'
        ],
        mechanism: 'negotiation_agents', // Uses existing negotiation system
        privacy_model: 'ephemeral_sessions' // Agent martyrdom
    }
};

// BUSINESS COORDINATION ENGINE EXAMPLES
// ====================================

const BUSINESS_COORDINATION_EXAMPLES = {
    
    project_circle: {
        central_entity: 'Q2_Marketing_Campaign',
        members: [
            { user: 'sarah_pm', role: 'project_manager', authority: 'high' },
            { user: 'mike_designer', role: 'creative_lead', authority: 'medium' },
            { user: 'lisa_copywriter', role: 'content_creator', authority: 'medium' },
            { user: 'david_ceo', role: 'executive_sponsor', authority: 'final_approval' }
        ],
        coordination_optimizations: [
            'schedule_team_standup_when_all_available',
            'allocate_design_resources_based_on_priority',
            'escalate_budget_concerns_to_executive_sponsor',
            'balance_workload_across_team_members',
            'optimize_review_cycles_for_faster_delivery'
        ]
    },

    budget_circle: {
        central_entity: '2026_Department_Budget',
        members: [
            { user: 'amanda_cfo', role: 'budget_owner', authority: 'approval' },
            { user: 'james_dept_head', role: 'budget_requestor', authority: 'request' },
            { user: 'nancy_finance', role: 'budget_analyst', authority: 'review' }
        ],
        coordination_optimizations: [
            'notify_when_budget_variance_exceeds_threshold',
            'schedule_budget_reviews_based_on_spend_velocity',
            'route_approvals_based_on_amount_and_authority_level',
            'aggregate_department_requests_for_executive_review',
            'optimize_cash_flow_timing_across_departments'
        ]
    },

    deal_circle: {
        central_entity: 'Enterprise_Client_Deal_Acme_Corp',
        members: [
            { user: 'carlos_sales', role: 'account_executive', authority: 'negotiate' },
            { user: 'priya_legal', role: 'legal_counsel', authority: 'contract_review' },
            { user: 'tom_technical', role: 'solutions_architect', authority: 'technical_spec' },
            { user: 'rachel_vp_sales', role: 'executive_sponsor', authority: 'final_approval' }
        ],
        coordination_optimizations: [
            'route_technical_questions_to_solutions_architect',
            'escalate_legal_concerns_to_counsel_immediately', 
            'schedule_client_demos_when_technical_team_available',
            'notify_executive_sponsor_when_deal_exceeds_authority_limit',
            'coordinate_proposal_timeline_across_all_stakeholders'
        ]
    }
};

// IMPLEMENTATION STRATEGY
// =======================

const IMPLEMENTATION_APPROACH = {
    
    step_1_reuse_existing_infrastructure: {
        tables: 'No changes needed to care_circles, care_circle_members, messages',
        routing: 'Extend contextAwareCompanionRouter to detect business vs medical context',
        agents: 'Same agent coordination patterns, different business logic'
    },

    step_2_context_aware_interpretation: {
        circle_detection: 'Analyze circle purpose and member roles to determine context',
        role_interpretation: 'Map roles based on context (medical: doctor, business: manager)',
        privacy_application: 'Apply HIPAA for medical, business confidentiality for professional'
    },

    step_3_coordination_engine_selection: {
        medical_circles: 'Use medical care optimization engine',
        professional_circles: 'Use business coordination optimization engine',
        cross_organizational: 'Route to negotiation system'
    },

    step_4_ai_behavior_adaptation: {
        medical_context: 'Empathetic, patient-safety-first behavior',
        business_context: 'Strategic, outcome-oriented, efficiency-focused behavior',
        optimization_focus: 'Within-org coordination vs across-org negotiation'
    }
};

export {
    CIRCLE_CONCEPT_MAPPING,
    COORDINATION_ENGINES,
    BUSINESS_COORDINATION_EXAMPLES,
    IMPLEMENTATION_APPROACH
};