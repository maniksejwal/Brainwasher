/**
 * @fileoverview Document-specific simulation scenarios for testing document drafting,
 * negotiation, collaboration, and approval workflows
 */

export const document_scenarios = {
    markdown_collaboration: {
        name: 'Markdown Document Collaboration',
        description: 'Multi-user markdown document editing with git-like diffs',
        complexity: 3,
        category: 'document_collaboration',
        duration: 'medium',
        users: [
            { role: 'target', personaKey: 'detail_oriented_target' },
            { role: 'support', personaKey: 'collaborative_support' },
            { role: 'expert', personaKey: 'technical_expert' }
        ],
        context: {
            document_type: 'project_proposal',
            collaboration_mode: 'concurrent_editing',
            approval_required: true
        },
        expected_behaviors: [
            'Document creation and initial draft',
            'Concurrent editing with conflict resolution',
            'Comment-based negotiation on changes',
            'Approval workflow integration'
        ]
    },

    contract_negotiation: {
        name: 'Contract Document Negotiation',
        description: 'Legal document negotiation with version control and approvals',
        complexity: 4,
        category: 'document_negotiation',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'legal_negotiator' },
            { role: 'support', personaKey: 'business_advisor' },
            { role: 'expert', personaKey: 'compliance_expert' }
        ],
        context: {
            document_type: 'service_agreement',
            negotiation_mode: 'adversarial_cooperative',
            privacy_level: 'business_confidential'
        },
        expected_behaviors: [
            'Document drafting with confidential sections',
            'Clause-by-clause negotiation',
            'Privacy-aware information disclosure',
            'Multi-stage approval process'
        ]
    },

    policy_document_approval: {
        name: 'Policy Document Approval Workflow',
        description: 'Organizational policy creation with hierarchical approvals',
        complexity: 3,
        category: 'document_approval',
        duration: 'medium',
        users: [
            { role: 'target', personaKey: 'policy_author' },
            { role: 'support', personaKey: 'stakeholder_representative' },
            { role: 'expert', personaKey: 'governance_expert' }
        ],
        context: {
            document_type: 'organizational_policy',
            approval_hierarchy: 'department_executive_board',
            change_tracking: true
        },
        expected_behaviors: [
            'Policy draft creation',
            'Stakeholder review and comments',
            'Hierarchical approval workflow',
            'Version tracking and audit trail'
        ]
    },

    technical_specification: {
        name: 'Technical Specification Document',
        description: 'Technical document with expert review and implementation approval',
        complexity: 4,
        category: 'document_approval',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'technical_architect' },
            { role: 'support', personaKey: 'project_manager' },
            { role: 'expert', personaKey: 'senior_technical_expert' }
        ],
        context: {
            document_type: 'technical_specification',
            review_type: 'peer_technical_review',
            implementation_approval: true
        },
        expected_behaviors: [
            'Technical requirement documentation',
            'Expert technical review with inline comments',
            'Implementation feasibility assessment',
            'Final approval for development'
        ]
    },

    limited_disclosure_negotiation: {
        name: 'Limited Disclosure Document Negotiation',
        description: 'Sensitive document negotiation with controlled information sharing',
        complexity: 5,
        category: 'document_privacy',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'confidential_negotiator' },
            { role: 'support', personaKey: 'privacy_advisor' },
            { role: 'expert', personaKey: 'security_expert' }
        ],
        context: {
            document_type: 'confidential_agreement',
            privacy_level: 'companion_confidential',
            disclosure_control: 'progressive_revelation'
        },
        expected_behaviors: [
            'Document creation with redacted sections',
            'Progressive information disclosure based on negotiation progress',
            'Privacy agent consultation before sensitive revelations',
            'Consent chain validation for information sharing'
        ]
    },

    meeting_minutes_collaboration: {
        name: 'Meeting Minutes Collaborative Editing',
        description: 'Post-meeting collaborative editing of minutes with approvals',
        complexity: 2,
        category: 'document_collaboration',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'meeting_organizer' },
            { role: 'support', personaKey: 'meeting_participant' },
            { role: 'expert', personaKey: 'subject_matter_expert' }
        ],
        context: {
            document_type: 'meeting_minutes',
            collaboration_mode: 'sequential_review',
            approval_required: true
        },
        expected_behaviors: [
            'Initial minutes draft creation',
            'Participant review and corrections',
            'Subject matter expert validation',
            'Final approval and distribution'
        ]
    },

    cross_org_document_negotiation: {
        name: 'Cross-Organizational Document Negotiation',
        description: 'Document negotiation between different organizations with privacy controls',
        complexity: 5,
        category: 'document_negotiation',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'external_negotiator' },
            { role: 'support', personaKey: 'internal_liaison' },
            { role: 'expert', personaKey: 'cross_org_specialist' }
        ],
        context: {
            document_type: 'partnership_agreement',
            organizational_scope: 'inter_organizational',
            privacy_level: 'organization_confined'
        },
        expected_behaviors: [
            'Document sharing across organizational boundaries',
            'Privacy-preserving negotiation tactics',
            'Information routing based on organizational affiliation',
            'Multi-organization approval coordination'
        ]
    },

    cross_org_technical_partnership: {
        name: 'Cross-Org Technical Partnership with Documentation',
        description: 'Technical partnership negotiation requiring both professional coordination and document collaboration',
        complexity: 5,
        category: 'professional_document_hybrid',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'technical_negotiator' },
            { role: 'support', personaKey: 'documentation_specialist' },
            { role: 'expert', personaKey: 'partnership_expert' }
        ],
        context: {
            document_types: ['technical_specification', 'partnership_agreement'],
            professional_dynamics: 'cross_organizational',
            collaboration_mode: 'concurrent_negotiation_and_documentation'
        },
        expected_behaviors: [
            'Professional circle coordination for partnership terms',
            'Simultaneous technical document collaboration',
            'Cross-organizational approval workflows',
            'Privacy-aware information sharing between organizations'
        ]
    },

    regulatory_compliance_documentation: {
        name: 'Regulatory Compliance with Professional Review',
        description: 'Professional team creating compliance documentation with expert review and approval',
        complexity: 4,
        category: 'professional_document_hybrid',
        duration: 'medium',
        users: [
            { role: 'target', personaKey: 'compliance_officer' },
            { role: 'support', personaKey: 'legal_support' },
            { role: 'expert', personaKey: 'regulatory_expert' }
        ],
        context: {
            document_type: 'compliance_manual',
            professional_hierarchy: 'department_level',
            approval_required: true
        },
        expected_behaviors: [
            'Professional circle role-based document access',
            'Expert review with inline professional feedback',
            'Hierarchical approval through professional relationships',
            'Document versioning with professional accountability'
        ]
    },

    merger_acquisition_documentation: {
        name: 'Merger Documentation with Professional Negotiation',
        description: 'M&A documentation requiring professional negotiation skills and document precision',
        complexity: 5,
        category: 'professional_document_hybrid',
        duration: 'long',
        users: [
            { role: 'target', personaKey: 'acquisition_lead' },
            { role: 'support', personaKey: 'financial_analyst' },
            { role: 'expert', personaKey: 'legal_expert' }
        ],
        context: {
            document_types: ['term_sheet', 'due_diligence_report', 'legal_agreements'],
            professional_dynamics: 'high_stakes_negotiation',
            confidentiality_level: 'business_confidential'
        },
        expected_behaviors: [
            'Professional negotiation tactics within document editing',
            'Limited disclosure based on negotiation progress',
            'Professional circle confidential communication',
            'Document approval gates aligned with professional hierarchy'
        ]
    },

    emergency_document_approval: {
        name: 'Emergency Document Fast-Track Approval',
        description: 'Rapid document approval process during crisis situations',
        complexity: 3,
        category: 'document_approval',
        duration: 'short',
        users: [
            { role: 'target', personaKey: 'crisis_coordinator' },
            { role: 'support', personaKey: 'emergency_support' },
            { role: 'expert', personaKey: 'crisis_expert' }
        ],
        context: {
            document_type: 'emergency_protocol',
            approval_mode: 'expedited',
            time_constraint: 'urgent'
        },
        expected_behaviors: [
            'Rapid document creation under time pressure',
            'Parallel review processes for speed',
            'Emergency approval authority delegation',
            'Post-crisis validation and updates'
        ]
    }
};

// Export professional personas for document scenarios
export const DOCUMENT_PERSONAS = {
    detail_oriented_target: {
        role: 'target',
        traits: ['thorough', 'methodical', 'quality-focused'],
        communication_style: 'precise and detailed',
        concerns: ['accuracy', 'completeness', 'clarity'],
        typical_actions: ['detailed review', 'specific feedback', 'quality checks']
    },
    
    collaborative_support: {
        role: 'support', 
        traits: ['cooperative', 'diplomatic', 'solution-oriented'],
        communication_style: 'inclusive and consensus-building',
        concerns: ['stakeholder alignment', 'feasibility', 'timeline'],
        typical_actions: ['facilitate discussion', 'gather input', 'build consensus']
    },
    
    technical_expert: {
        role: 'expert',
        traits: ['analytical', 'authoritative', 'standards-focused'],
        communication_style: 'technical and precise',
        concerns: ['technical accuracy', 'best practices', 'implementation'],
        typical_actions: ['technical review', 'standards validation', 'expert recommendations']
    },
    
    legal_negotiator: {
        role: 'target',
        traits: ['cautious', 'strategic', 'risk-aware'],
        communication_style: 'formal and careful',
        concerns: ['legal compliance', 'risk mitigation', 'enforceability'],
        typical_actions: ['legal review', 'risk assessment', 'clause negotiation']
    },
    
    confidential_negotiator: {
        role: 'target',
        traits: ['discreet', 'strategic', 'information-protective'],
        communication_style: 'measured and careful about disclosure',
        concerns: ['confidentiality', 'competitive advantage', 'information security'],
        typical_actions: ['limited disclosure', 'strategic information sharing', 'privacy consultation']
    },
    
    privacy_advisor: {
        role: 'support',
        traits: ['privacy-focused', 'compliant', 'protective'],
        communication_style: 'cautious and security-minded',
        concerns: ['data protection', 'consent validation', 'privacy compliance'],
        typical_actions: ['privacy review', 'consent verification', 'disclosure approval']
    },
    
    acquisition_lead: {
        role: 'target',
        traits: ['strategic', 'decisive', 'value-focused'],
        communication_style: 'assertive and results-driven',
        concerns: ['deal value', 'timeline', 'integration risks'],
        typical_actions: ['strategic analysis', 'value negotiation', 'timeline management']
    },
    
    financial_analyst: {
        role: 'support',
        traits: ['analytical', 'detail-oriented', 'risk-conscious'],
        communication_style: 'data-driven and precise',
        concerns: ['financial accuracy', 'due diligence completeness', 'valuation models'],
        typical_actions: ['financial modeling', 'risk assessment', 'data validation']
    },
    
    compliance_officer: {
        role: 'target', 
        traits: ['meticulous', 'rule-following', 'systematic', 'authoritative', 'experienced'],
        communication_style: 'formal and procedure-oriented',
        concerns: ['regulatory compliance', 'audit readiness', 'documentation completeness'],
        typical_actions: ['compliance review', 'procedure documentation', 'audit preparation', 'policy enforcement', 'risk assessment', 'regulatory interpretation', 'compliance guidance', 'risk mitigation']
    },
    
    regulatory_expert: {
        role: 'expert',
        traits: ['regulatory_focused', 'compliance_oriented', 'policy_expert'],
        communication_style: 'formal and policy-driven',
        concerns: ['regulatory compliance', 'audit readiness', 'documentation completeness'],
        typical_actions: ['compliance review', 'procedure documentation', 'audit preparation']
    },
    
    legal_support: {
        role: 'support',
        traits: ['legal_focused', 'compliant', 'risk-aware'],
        communication_style: 'formal and risk-focused',
        concerns: ['legal compliance', 'risk mitigation', 'documentation accuracy'],
        typical_actions: ['legal review', 'risk assessment', 'documentation accuracy']
    },
    
    crisis_expert: {
        role: 'expert',
        traits: ['calm_under_pressure', 'decisive', 'emergency_focused'],
        communication_style: 'clear and urgent',
        concerns: ['public safety', 'rapid response', 'resource allocation'],
        typical_actions: ['crisis assessment', 'emergency coordination', 'rapid decision making']
    },
    
    crisis_coordinator: {
        role: 'target',
        traits: ['leadership_oriented', 'crisis_experienced', 'coordination_focused'],
        communication_style: 'authoritative and organized',
        concerns: ['response coordination', 'stakeholder communication', 'crisis resolution'],
        typical_actions: ['crisis management', 'team coordination', 'stakeholder updates']
    },
    
    emergency_support: {
        role: 'support',
        traits: ['responsive', 'detail_oriented', 'support_focused'],
        communication_style: 'efficient and supportive',
        concerns: ['resource availability', 'team support', 'process efficiency'],
        typical_actions: ['resource coordination', 'team support', 'process facilitation']
    },
    
    security_expert: {
        role: 'expert',
        traits: ['security-focused', 'risk-aware', 'protective'],
        communication_style: 'authoritative on security matters',
        concerns: ['information security', 'access control', 'threat assessment'],
        typical_actions: ['security validation', 'access control review', 'threat analysis']
    },
    
    detail_oriented_target: {
        name: 'Sarah Chen',
        description: 'Detail-Oriented Target',
        age: 34,
        gender: 'female',
        role: 'target', // Maps to patient in simulation
        relationship_type: 'detail_oriented_target',
        traits: ['thorough', 'methodical', 'quality-focused'],
        communication_style: 'precise and detailed',
        concerns: ['accuracy', 'completeness', 'clarity'],
        typical_actions: ['detailed review', 'specific feedback', 'quality checks'],
        sample_messages: [
            'I noticed several inconsistencies in section 3.2 that need addressing',
            'Can we add more specific metrics to measure success?',
            'The timeline in appendix B doesn\'t align with the main document'
        ],
        prompt_template: `You are Sarah Chen, a 34-year-old detail-oriented professional. You're thorough, methodical, and quality-focused. You communicate precisely with detailed feedback and focus on accuracy, completeness, and clarity in all documents.`
    },

    collaborative_support: {
        name: 'Marcus Johnson',
        description: 'Collaborative Support',
        age: 31,
        gender: 'male',
        role: 'support', // Maps to caregiver in simulation
        relationship_type: 'collaborative_support',
        traits: ['cooperative', 'diplomatic', 'solution-oriented'],
        communication_style: 'inclusive and consensus-building',
        concerns: ['stakeholder alignment', 'feasibility', 'timeline'],
        typical_actions: ['facilitate discussion', 'gather input', 'build consensus'],
        sample_messages: [
            'Let me coordinate with all stakeholders to gather their input',
            'I think we can find a solution that works for everyone',
            'Would it help if I set up a working session to resolve this?'
        ],
        prompt_template: `You are Marcus Johnson, a 31-year-old collaborative support professional. You're cooperative, diplomatic, and solution-oriented. You communicate inclusively while building consensus and focus on stakeholder alignment, feasibility, and timeline management.`
    },

    technical_expert: {
        name: 'Dr. Priya Sharma',
        description: 'Technical Expert',
        age: 37,
        gender: 'female',
        role: 'expert', // Maps to doctor in simulation
        relationship_type: 'technical_expert',
        traits: ['analytical', 'authoritative', 'standards-focused'],
        communication_style: 'technical and precise',
        concerns: ['technical accuracy', 'best practices', 'implementation'],
        typical_actions: ['technical review', 'standards validation', 'expert recommendations'],
        sample_messages: [
            'The proposed architecture doesn\'t follow industry best practices',
            'We need to consider scalability requirements in the technical specs',
            'I recommend implementing these security standards for compliance'
        ],
        prompt_template: `You are Dr. Priya Sharma, a 37-year-old technical expert. You're analytical, authoritative, and standards-focused. You communicate technically and precisely, focusing on technical accuracy, best practices, and implementation feasibility.`
    },

    crisis_coordinator: {
        name: 'Captain Maria Rodriguez',
        description: 'Crisis Coordinator',
        age: 41,
        gender: 'female',
        role: 'target', // Maps to patient in simulation
        relationship_type: 'crisis_coordinator',
        traits: ['leadership_oriented', 'crisis_experienced', 'coordination_focused'],
        communication_style: 'authoritative and organized',
        concerns: ['response coordination', 'stakeholder communication', 'crisis resolution'],
        typical_actions: ['crisis management', 'team coordination', 'stakeholder updates'],
        sample_messages: [
            'We need immediate action on the emergency response protocol',
            'I\'ll coordinate with all departments to ensure unified response',
            'Time is critical - we need decisions within the hour'
        ],
        prompt_template: `You are Captain Maria Rodriguez, a 41-year-old crisis coordinator. You're leadership-oriented, crisis-experienced, and coordination-focused. You communicate authoritatively and organize response efforts, focusing on coordination, communication, and rapid crisis resolution.`
    },

    emergency_support: {
        name: 'Lt. David Park',
        description: 'Emergency Support',
        age: 29,
        gender: 'male',
        role: 'support', // Maps to caregiver in simulation
        relationship_type: 'emergency_support',
        traits: ['responsive', 'detail_oriented', 'support_focused'],
        communication_style: 'efficient and supportive',
        concerns: ['resource availability', 'team support', 'process efficiency'],
        typical_actions: ['resource coordination', 'team support', 'process facilitation'],
        sample_messages: [
            'I\'ve secured the resources we need for immediate deployment',
            'The team is ready and standing by for your orders',
            'All support systems are operational and on standby'
        ],
        prompt_template: `You are Lt. David Park, a 29-year-old emergency support specialist. You're responsive, detail-oriented, and support-focused. You communicate efficiently while providing support, focusing on resource availability, team support, and process efficiency.`
    },

    crisis_expert: {
        name: 'Dr. Angela Foster',
        description: 'Crisis Expert',
        age: 48,
        gender: 'female',
        role: 'expert', // Maps to doctor in simulation
        relationship_type: 'crisis_expert',
        traits: ['calm_under_pressure', 'decisive', 'emergency_focused'],
        communication_style: 'clear and urgent',
        concerns: ['public safety', 'rapid response', 'resource allocation'],
        typical_actions: ['crisis assessment', 'emergency coordination', 'rapid decision making'],
        sample_messages: [
            'Based on threat assessment, we need to escalate immediately',
            'The situation requires Category 3 response protocols',
            'We have a 4-hour window to contain this effectively'
        ],
        prompt_template: `You are Dr. Angela Foster, a 48-year-old crisis expert. You're calm under pressure, decisive, and emergency-focused. You communicate clearly with urgency, focusing on public safety, rapid response, and optimal resource allocation during crises.`
    }
};