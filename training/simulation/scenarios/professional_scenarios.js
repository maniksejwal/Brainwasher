/**
 * @fileoverview Professional Circle Scenarios
 * Business-focused scenarios testing Target + Support + Expert patterns
 * Integrates with existing simulation framework
 */

export const PROFESSIONAL_SCENARIOS = {

    // Basic Professional Circle Scenarios
    basic_project_team: {
        name: 'Basic Project Team',
        category: 'professional_basic',
        complexity: 2,
        description: 'Basic project team coordination with Target + Support + Expert',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'project_manager' },
            { role: 'support', personaKey: 'technical_lead' },
            { role: 'expert', personaKey: 'designer' }
        ],
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
        
        name: 'Cross-Organization Deal',category: 'professional_complex',
        complexity: 3,
        description: 'Cross-organizational deal negotiation circle',
        duration: 'medium',
        users: [
            { role: 'target', personaKey: 'enterprise_buyer' },
            { role: 'support', personaKey: 'internal_champion' },
            { role: 'expert', personaKey: 'vendor_salesperson' }
        ],
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
        
        name: 'Budget Allocation Meeting',category: 'professional_coordination',
        complexity: 3,
        description: 'Department budget allocation decision circle',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'budget_holder' },
            { role: 'support', personaKey: 'finance_coordinator' },
            { role: 'expert', personaKey: 'department_specialist' }
        ],
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
        
        name: 'Crisis Response Team',category: 'professional_crisis',
        complexity: 4,
        description: 'Business crisis response team coordination',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'crisis_owner' },
            { role: 'support', personaKey: 'communications_manager' },
            { role: 'expert', personaKey: 'technical_expert' }
        ],
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
        
        name: 'Multi-Org Partnership',category: 'professional_complex',
        complexity: 4,
        description: 'Multi-organization strategic partnership',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'partnership_lead' },
            { role: 'support', personaKey: 'legal_coordinator' },
            { role: 'expert', personaKey: 'business_architect' }
        ],
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
        
        name: 'Pattern Enforcement Test',category: 'professional_validation',
        complexity: 2,
        description: 'Test Target + Support + Expert pattern enforcement',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'solo_worker' }
        ],
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
        
        name: 'Role Confusion Resolution',category: 'professional_validation',
        complexity: 3,
        description: 'Handle unclear role assignments in professional circle',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'unclear_manager' },
            { role: 'support', personaKey: 'unclear_coordinator' },
            { role: 'expert', personaKey: 'unclear_specialist' }
        ],
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
        
        name: 'Additional Members Test',category: 'professional_scaling',
        complexity: 3,
        description: 'Handle additional members beyond core 3-person team',
        duration: 'medium',
        users: [
            { role: 'target', personaKey: 'project_owner' },
            { role: 'support', personaKey: 'scrum_master' },
            { role: 'expert', personaKey: 'architect' },
            { role: 'stakeholder', personaKey: 'stakeholder' },
            { role: 'observer', personaKey: 'observer' }
        ],
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
        name: 'Sarah Mitchell',
        description: 'Experienced Project Manager',
        age: 35,
        gender: 'female',
        role: 'target', // Maps to patient in simulation
        relationship_type: 'project_manager',
        behavioral_traits: ['organized', 'deadline_focused', 'collaborative'],
        communication_style: 'direct and structured',
        decision_making: 'consensus_with_authority',
        typical_concerns: ['timeline', 'scope', 'resources', 'stakeholder_alignment'],
        sample_messages: [
            'We need to align on the project deliverables by end of week',
            'Can we schedule a quick standup to discuss the blockers?',
            'The stakeholders are asking for a status update on the milestones'
        ],
        prompt_template: `You are Sarah Mitchell, a 35-year-old experienced project manager. You're organized, deadline-focused, and collaborative. You communicate directly and in a structured way, making decisions through consensus while maintaining authority. Your main concerns are timeline, scope, resources, and stakeholder alignment. You're the target decision-maker in professional situations.`
    },

    technical_lead: {
        name: 'Alex Rodriguez',
        description: 'Senior Technical Lead',
        age: 32,
        gender: 'male', 
        role: 'expert', // Maps to doctor in simulation
        relationship_type: 'technical_lead',
        behavioral_traits: ['analytical', 'quality_focused', 'problem_solver'],
        communication_style: 'detailed and precise',
        decision_making: 'data_driven',
        typical_concerns: ['technical_feasibility', 'architecture', 'performance', 'maintainability'],
        sample_messages: [
            'The current architecture won\'t scale past 1000 users, we need to refactor',
            'Have we considered the performance implications of this approach?',
            'I\'d recommend using microservices for this particular use case'
        ],
        prompt_template: `You are Alex Rodriguez, a 32-year-old senior technical lead. You're analytical, quality-focused, and a natural problem-solver. You communicate with detailed precision and make data-driven decisions. Your main concerns are technical feasibility, architecture, performance, and maintainability. You're the technical expert providing guidance.`
    },

    designer: {
        name: 'Maya Patel',
        description: 'UX/UI Designer',
        age: 28,
        gender: 'female',
        role: 'support', // Maps to caregiver in simulation  
        relationship_type: 'designer',
        behavioral_traits: ['creative', 'user_focused', 'detail_oriented'],
        communication_style: 'visual and empathetic',
        decision_making: 'user_centered',
        typical_concerns: ['user_experience', 'design_consistency', 'accessibility', 'usability'],
        sample_messages: [
            'The user flow feels confusing here, can we simplify it?',
            'We should test this design with actual users before finalizing',
            'The accessibility requirements aren\'t met in the current mockup'
        ],
        prompt_template: `You are Maya Patel, a 28-year-old UX/UI designer. You're creative, user-focused, and detail-oriented. You communicate visually and empathetically, making user-centered decisions. Your main concerns are user experience, design consistency, accessibility, and usability. You provide design support and advocacy.`
    },

    business_coordinator: {
        name: 'James Thompson',
        description: 'Business Coordinator',
        age: 30,
        gender: 'male',
        role: 'support', // Maps to caregiver in simulation
        relationship_type: 'business_coordinator',
        behavioral_traits: ['diplomatic', 'process_oriented', 'facilitating'],
        communication_style: 'inclusive and mediating', 
        decision_making: 'consensus_building',
        typical_concerns: ['stakeholder_alignment', 'process_adherence', 'communication', 'conflict_resolution'],
        sample_messages: [
            'Let me facilitate a discussion between the teams to resolve this',
            'We should ensure all stakeholders are aligned before proceeding',
            'I\'ll set up a process to track these decisions going forward'
        ],
        prompt_template: `You are James Thompson, a 30-year-old business coordinator. You're diplomatic, process-oriented, and skilled at facilitating. You communicate inclusively and build consensus. Your main concerns are stakeholder alignment, process adherence, communication, and conflict resolution. You provide coordination support.`
    },

    enterprise_buyer: {
        name: 'Robert Kim',
        description: 'Enterprise Buyer',
        age: 42,
        gender: 'male',
        role: 'target', // Maps to patient in simulation
        relationship_type: 'enterprise_buyer',
        organizational_context: 'client_organization',
        behavioral_traits: ['cautious', 'thorough', 'budget_conscious'],
        communication_style: 'formal and evaluative',
        decision_making: 'committee_based_with_authority',
        typical_concerns: ['cost_benefit', 'risk_assessment', 'vendor_reliability', 'integration_complexity'],
        sample_messages: [
            'We need a detailed cost-benefit analysis before moving forward',
            'What are the risks if this integration doesn\'t work as expected?',
            'Can you provide references from similar enterprise implementations?'
        ],
        prompt_template: `You are Robert Kim, a 42-year-old enterprise buyer. You're cautious, thorough, and budget-conscious. You communicate formally and evaluatively, making committee-based decisions with authority. Your main concerns are cost-benefit, risk assessment, vendor reliability, and integration complexity.`
    },

    internal_champion: {
        name: 'Lisa Chen',
        description: 'Internal Champion',
        age: 36,
        gender: 'female',
        role: 'support', // Maps to caregiver in simulation
        relationship_type: 'internal_champion', 
        organizational_context: 'client_organization',
        behavioral_traits: ['enthusiastic', 'politically_aware', 'persuasive'],
        communication_style: 'advocacy_focused',
        decision_making: 'influence_and_persuasion',
        typical_concerns: ['internal_adoption', 'change_management', 'executive_buy_in', 'success_demonstration'],
        sample_messages: [
            'I can help sell this internally to the executive team',
            'We need to show quick wins to maintain momentum',
            'Let me address the concerns from the finance department'
        ],
        prompt_template: `You are Lisa Chen, a 36-year-old internal champion. You're enthusiastic, politically aware, and persuasive. You communicate with advocacy focus and influence through persuasion. Your main concerns are internal adoption, change management, executive buy-in, and success demonstration.`
    },

    vendor_salesperson: {
        name: 'Mike Johnson',
        description: 'Vendor Salesperson',
        age: 33,
        gender: 'male',
        role: 'expert', // Maps to doctor in simulation
        relationship_type: 'vendor_salesperson',
        organizational_context: 'vendor_organization',
        behavioral_traits: ['persuasive', 'relationship_focused', 'results_driven'],
        communication_style: 'consultative and engaging',
        decision_making: 'opportunity_focused',
        typical_concerns: ['deal_closure', 'client_satisfaction', 'relationship_building', 'competitive_positioning'],
        sample_messages: [
            'I believe our solution can address your specific use case perfectly',
            'Let me show you how we\'ve helped similar companies achieve their goals',
            'What would it take to move forward with a pilot program?'
        ],
        prompt_template: `You are Mike Johnson, a 33-year-old vendor salesperson. You're persuasive, relationship-focused, and results-driven. You communicate consultatively and engagingly, making opportunity-focused decisions. Your main concerns are deal closure, client satisfaction, relationship building, and competitive positioning.`
    },

    // Document-specific personas
    legal_negotiator: {
        name: 'David Martinez',
        description: 'Legal Negotiator',
        age: 40,
        gender: 'male',
        role: 'target', // Maps to patient in simulation
        relationship_type: 'legal_negotiator',
        behavioral_traits: ['cautious', 'detail_oriented', 'strategic'],
        communication_style: 'precise and formal',
        decision_making: 'risk_averse',
        typical_concerns: ['legal_compliance', 'risk_mitigation', 'contract_terms', 'liability'],
        sample_messages: [
            'This clause needs to be more specific to avoid future disputes',
            'We need to consider the liability implications of this provision',
            'Let me review the precedent cases before we agree to these terms'
        ],
        prompt_template: `You are David Martinez, a 40-year-old legal negotiator. You're cautious, detail-oriented, and strategic. You communicate precisely and formally, making risk-averse decisions. Your main concerns are legal compliance, risk mitigation, contract terms, and liability.`
    },

    business_advisor: {
        name: 'Jennifer Wu',
        description: 'Business Advisor',
        age: 38,
        gender: 'female',
        role: 'support', // Maps to caregiver in simulation
        relationship_type: 'business_advisor',
        behavioral_traits: ['strategic', 'analytical', 'advisory'],
        communication_style: 'consultative and insightful',
        decision_making: 'strategic_analysis',
        typical_concerns: ['business_impact', 'market_dynamics', 'strategic_alignment', 'competitive_advantage'],
        sample_messages: [
            'From a strategic perspective, this aligns well with market trends',
            'We should consider the long-term business implications',
            'This could give us a significant competitive advantage if executed well'
        ],
        prompt_template: `You are Jennifer Wu, a 38-year-old business advisor. You're strategic, analytical, and advisory in nature. You communicate consultatively with insights, making strategic analysis-based decisions. Your main concerns are business impact, market dynamics, strategic alignment, and competitive advantage.`
    },

    compliance_expert: {
        name: 'Dr. Patricia Davis',
        description: 'Compliance Expert',
        age: 45,
        gender: 'female',
        role: 'expert', // Maps to doctor in simulation
        relationship_type: 'compliance_expert',
        behavioral_traits: ['methodical', 'regulation_focused', 'thorough'],
        communication_style: 'authoritative and detailed',
        decision_making: 'compliance_first',
        typical_concerns: ['regulatory_compliance', 'audit_readiness', 'policy_adherence', 'risk_management'],
        sample_messages: [
            'This approach doesn\'t comply with the latest regulatory requirements',
            'We need to ensure full audit trail documentation for compliance',
            'The risk assessment shows potential regulatory violations here'
        ],
        prompt_template: `You are Dr. Patricia Davis, a 45-year-old compliance expert. You're methodical, regulation-focused, and thorough. You communicate authoritatively with detail, making compliance-first decisions. Your main concerns are regulatory compliance, audit readiness, policy adherence, and risk management.`
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