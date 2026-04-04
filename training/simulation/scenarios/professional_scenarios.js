/**
 * @fileoverview Professional Circle Scenarios
 * Business-focused scenarios testing Target + Support + Expert patterns
 * Integrates with existing simulation framework
 */

export const PROFESSIONAL_SCENARIOS = {

    // Basic Professional Circle Scenarios
    basic_project_team: {
        category: 'professional_basic',
        complexity: 'simple',
        description: 'Basic project team coordination with Target + Support + Expert',
        duration: 'short',
        personas: ['project_manager', 'technical_lead', 'designer'],
        trigger: 'New mobile app feature needs to be planned',
        expected_behaviors: [
            'Identify the Target (decision maker)',
            'Coordinate between Support (facilitator) and Expert (specialist)',
            'Validate professional circle pattern (minimum 3 roles)',
            'Handle intra-organizational communication'
        ],
        success_criteria: {
            pattern_validation: 'Must enforce Target + Support + Expert minimum',
            role_clarity: 'Each member should understand their role',
            coordination: 'Should facilitate decision-making process'
        }
    },

    cross_org_deal: {
        category: 'professional_complex',
        complexity: 'medium',
        description: 'Cross-organizational deal negotiation circle',
        duration: 'medium',
        personas: ['enterprise_buyer', 'internal_champion', 'vendor_salesperson'],
        trigger: 'Enterprise client evaluating new software solution',
        expected_behaviors: [
            'Handle inter-organizational dynamics',
            'Maintain confidentiality across organizations',
            'Support negotiated optimization (not internal)',
            'Balance competing interests'
        ],
        success_criteria: {
            privacy_handling: 'Should respect cross-org confidentiality',
            negotiation_support: 'Should facilitate fair deal-making',
            relationship_preservation: 'Should maintain business relationships'
        }
    },

    budget_allocation: {
        category: 'professional_coordination',
        complexity: 'medium',
        description: 'Department budget allocation decision circle',
        duration: 'short',
        personas: ['budget_holder', 'finance_coordinator', 'department_specialist'],
        trigger: 'Q4 budget needs to be allocated across initiatives',
        expected_behaviors: [
            'Support data-driven decision making',
            'Handle competing resource requests',
            'Escalate budget conflicts appropriately',
            'Track allocation decisions'
        ],
        success_criteria: {
            decision_support: 'Should help budget holder make informed decisions',
            transparency: 'Should track allocation rationale',
            conflict_resolution: 'Should handle resource competition'
        }
    },

    crisis_response: {
        category: 'professional_crisis',
        complexity: 'high',
        description: 'Business crisis response team coordination',
        duration: 'short',
        personas: ['crisis_owner', 'communications_manager', 'technical_expert'],
        trigger: 'Production system outage affecting customers',
        expected_behaviors: [
            'Switch to crisis coordination mode',
            'Prioritize rapid resolution over consensus',
            'Escalate to appropriate authorities',
            'Coordinate multi-team response'
        ],
        success_criteria: {
            response_speed: 'Should prioritize immediate action',
            authority_handling: 'Should respect crisis decision hierarchy',
            communication: 'Should coordinate internal and external messaging'
        }
    },

    multi_org_partnership: {
        category: 'professional_complex',
        complexity: 'high',
        description: 'Multi-organization strategic partnership',
        duration: 'long',
        personas: ['partnership_lead', 'legal_coordinator', 'business_architect'],
        trigger: 'Three companies forming strategic alliance',
        expected_behaviors: [
            'Handle hybrid organizational scope',
            'Manage complex stakeholder interests',
            'Support long-term relationship building',
            'Navigate legal and business constraints'
        ],
        success_criteria: {
            stakeholder_management: 'Should balance multiple organizational interests',
            relationship_building: 'Should support long-term partnership goals',
            complexity_handling: 'Should manage multi-party dynamics'
        }
    },

    // Professional Circle Pattern Validation Scenarios
    pattern_enforcement: {
        category: 'professional_validation',
        complexity: 'simple',
        description: 'Test Target + Support + Expert pattern enforcement',
        duration: 'short',
        personas: ['solo_worker'], // Intentionally insufficient
        trigger: 'Someone tries to create single-person professional circle',
        expected_behaviors: [
            'Reject insufficient team size',
            'Require minimum 3 core roles',
            'Suggest appropriate role additions',
            'Explain professional circle pattern'
        ],
        success_criteria: {
            validation_failure: 'Should reject < 3 person circles',
            guidance_provided: 'Should suggest how to complete the pattern',
            pattern_education: 'Should explain Target + Support + Expert roles'
        }
    },

    role_confusion: {
        category: 'professional_validation',
        complexity: 'medium',
        description: 'Handle unclear role assignments in professional circle',
        duration: 'short',
        personas: ['unclear_manager', 'unclear_coordinator', 'unclear_specialist'],
        trigger: 'Team members unsure of their Target/Support/Expert roles',
        expected_behaviors: [
            'Help clarify role assignments',
            'Explain Target + Support + Expert functions',
            'Support role negotiation process',
            'Validate final role assignments'
        ],
        success_criteria: {
            role_clarity: 'Should help establish clear role definitions',
            pattern_compliance: 'Should ensure all core roles are filled',
            team_alignment: 'Should facilitate agreement on responsibilities'
        }
    },

    additional_members: {
        category: 'professional_scaling',
        complexity: 'medium',
        description: 'Handle additional members beyond core 3-person team',
        duration: 'medium',
        personas: ['project_owner', 'scrum_master', 'architect', 'stakeholder', 'observer'],
        trigger: 'Core project team needs to add stakeholders and observers',
        expected_behaviors: [
            'Accept additional members beyond minimum 3',
            'Distinguish core team from additional members',
            'Handle varying participation levels',
            'Maintain pattern integrity with growth'
        ],
        success_criteria: {
            scalability: 'Should support teams larger than 3 people',
            core_preservation: 'Should maintain Target + Support + Expert core',
            role_management: 'Should handle different member types appropriately'
        }
    }
};

// Professional Circle Personas for Business Contexts
export const PROFESSIONAL_PERSONAS = {
    
    project_manager: {
        role: 'project_manager',
        relationship_type: 'target',
        behavioral_traits: ['organized', 'deadline_focused', 'collaborative'],
        communication_style: 'direct and structured',
        decision_making: 'consensus_with_authority',
        typical_concerns: ['timeline', 'scope', 'resources', 'stakeholder_alignment']
    },

    technical_lead: {
        role: 'technical_lead', 
        relationship_type: 'expert',
        behavioral_traits: ['analytical', 'quality_focused', 'problem_solver'],
        communication_style: 'detailed and precise',
        decision_making: 'data_driven',
        typical_concerns: ['technical_feasibility', 'architecture', 'performance', 'maintainability']
    },

    business_coordinator: {
        role: 'business_coordinator',
        relationship_type: 'support',
        behavioral_traits: ['diplomatic', 'process_oriented', 'facilitating'],
        communication_style: 'inclusive and mediating', 
        decision_making: 'consensus_building',
        typical_concerns: ['stakeholder_alignment', 'process_adherence', 'communication', 'conflict_resolution']
    },

    enterprise_buyer: {
        role: 'enterprise_buyer',
        relationship_type: 'target',
        organizational_context: 'client_organization',
        behavioral_traits: ['cautious', 'thorough', 'budget_conscious'],
        communication_style: 'formal and evaluative',
        decision_making: 'committee_based_with_authority',
        typical_concerns: ['cost_benefit', 'risk_assessment', 'vendor_reliability', 'integration_complexity']
    },

    internal_champion: {
        role: 'internal_champion',
        relationship_type: 'support', 
        organizational_context: 'client_organization',
        behavioral_traits: ['enthusiastic', 'politically_aware', 'persuasive'],
        communication_style: 'advocacy_focused',
        decision_making: 'influence_and_persuasion',
        typical_concerns: ['internal_adoption', 'change_management', 'executive_buy_in', 'success_demonstration']
    },

    vendor_salesperson: {
        role: 'vendor_salesperson',
        relationship_type: 'expert',
        organizational_context: 'vendor_organization', 
        behavioral_traits: ['relationship_focused', 'solution_oriented', 'persistent'],
        communication_style: 'consultative_selling',
        decision_making: 'customer_needs_driven',
        typical_concerns: ['customer_satisfaction', 'solution_fit', 'competitive_differentiation', 'deal_closure']
    }
};

// Export scenario categories for integration with existing system
export const PROFESSIONAL_SCENARIO_CATEGORIES = {
    professional_basic: 'Basic Professional Team Scenarios',
    professional_complex: 'Complex Multi-Organizational Scenarios',
    professional_coordination: 'Business Coordination Scenarios', 
    professional_crisis: 'Crisis Response Scenarios',
    professional_validation: 'Pattern Validation Scenarios',
    professional_scaling: 'Team Scaling Scenarios'
};