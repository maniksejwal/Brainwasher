/**
 * @fileoverview Supervised Dialog Graph Framework
 * Expert-validated conversation patterns for controlled testing
 */

/**
 * Dialog Graph represents expert-validated conversation flows
 */
class DialogGraph {
    constructor(graphId, domain, expertValidatedBy, description) {
        this.graphId = graphId;
        this.domain = domain; // 'medical', 'business', 'mixed'
        this.expertValidatedBy = expertValidatedBy;
        this.description = description;
        this.nodes = new Map(); // conversation states
        this.edges = new Map(); // valid transitions
        this.successCriteria = [];
        this.failureCriteria = [];
        this.expertNotes = [];
    }

    /**
     * Add conversation state with expert validation
     */
    addNode(nodeId, nodeData) {
        this.nodes.set(nodeId, {
            id: nodeId,
            type: nodeData.type, // 'user_input', 'agent_response', 'branch_point', 'success', 'failure'
            expectedContent: nodeData.expectedContent, // What should be discussed
            validationRules: nodeData.validationRules, // How to validate quality
            expertExample: nodeData.expertExample, // Gold standard example
            commonMistakes: nodeData.commonMistakes || [], // What agents do wrong
            requiredElements: nodeData.requiredElements || [], // Must contain these
            forbiddenElements: nodeData.forbiddenElements || [], // Must not contain these
            domain: nodeData.domain, // 'medical', 'business'
            criticality: nodeData.criticality, // 'low', 'medium', 'high', 'critical'
            expertNotes: nodeData.expertNotes || ''
        });
    }

    /**
     * Add valid transition between states
     */
    addEdge(fromNode, toNode, transitionData) {
        const edgeKey = `${fromNode}->${toNode}`;
        this.edges.set(edgeKey, {
            from: fromNode,
            to: toNode,
            trigger: transitionData.trigger, // What causes this transition
            probability: transitionData.probability, // Expert-estimated likelihood
            qualityMetrics: transitionData.qualityMetrics, // How to measure quality
            expertValidation: transitionData.expertValidation // Expert says this is good/bad
        });
    }
}

// EXPERT-VALIDATED DIALOG GRAPHS
// ===============================

const MEDICAL_PAIN_ASSESSMENT = new DialogGraph(
    'medical_pain_assessment_v1',
    'medical', 
    'Dr. Sarah Johnson, Pain Management Specialist',
    'Proper clinical pain assessment conversation flow'
);

// Add expert-validated conversation nodes
MEDICAL_PAIN_ASSESSMENT.addNode('initial_report', {
    type: 'user_input',
    expectedContent: 'Patient reports pain symptoms',
    validationRules: {
        shouldContain: ['pain', 'hurt', 'ache', 'discomfort'],
        shouldNotContain: ['cure', 'diagnosis', 'prescription']
    },
    expertExample: "I've been having this throbbing pain in my lower back for 3 days. It's getting worse when I sit.",
    commonMistakes: ['Too vague', 'Multiple unrelated symptoms', 'Self-diagnosis'],
    requiredElements: ['location', 'duration', 'quality'],
    criticality: 'high',
    expertNotes: 'Initial pain report must include location, duration, and some quality description'
});

MEDICAL_PAIN_ASSESSMENT.addNode('agent_pain_inquiry', {
    type: 'agent_response',
    expectedContent: 'Systematic pain assessment using clinical standards',
    validationRules: {
        mustAsk: ['pain_scale', 'onset', 'aggravating_factors', 'relieving_factors'],
        shouldNotDiagnose: true,
        shouldShowEmpathy: true
    },
    expertExample: `I understand you're experiencing significant back pain. To help assess this properly, could you:
1. Rate your pain from 1-10 right now
2. Tell me exactly when it started
3. What makes it worse or better
4. Have you tried any treatments?

I want to make sure we understand this fully before discussing next steps.`,
    commonMistakes: [
        'Jumping to diagnosis',
        'Not using pain scale', 
        'Missing systematic approach',
        'No empathy expression',
        'Asking too many questions at once'
    ],
    requiredElements: ['empathy_acknowledgment', 'systematic_questions', 'reassurance'],
    forbiddenElements: ['diagnosis', 'prescription', 'dismissive_language'],
    criticality: 'critical',
    expertNotes: 'Must follow clinical pain assessment protocol. Empathy essential for patient trust.'
});

MEDICAL_PAIN_ASSESSMENT.addNode('pain_scale_response', {
    type: 'user_input',
    expectedContent: 'Patient provides pain scale rating and additional details',
    validationRules: {
        shouldContain: ['number', 'scale'],
        responseToQuestions: true
    },
    expertExample: "I'd say it's about a 7 out of 10 right now. It started suddenly Monday morning when I was lifting boxes. Sitting makes it much worse, lying down helps a bit. I've tried ibuprofen but it barely touches it.",
    requiredElements: ['pain_rating', 'onset_detail', 'modifying_factors'],
    criticality: 'high'
});

MEDICAL_PAIN_ASSESSMENT.addNode('agent_assessment_summary', {
    type: 'agent_response',
    expectedContent: 'Summarize findings and outline next steps without diagnosing',
    validationRules: {
        mustSummarize: ['location', 'severity', 'onset', 'modifiers'],
        mustOutlineNextSteps: true,
        shouldNotDiagnose: true,
        shouldReassure: true
    },
    expertExample: `Thank you for those details. Let me summarize what I understand:
- Lower back pain, 7/10 severity
- Started suddenly Monday during lifting
- Worse with sitting, better lying down  
- Limited response to ibuprofen

Based on this pattern, I recommend we have you evaluated by your doctor for a proper examination. In the meantime, here are some safe approaches that might help...`,
    commonMistakes: [
        'Providing diagnosis',
        'Missing key details in summary',
        'No clear next steps',
        'Recommending specific medications'
    ],
    requiredElements: ['accurate_summary', 'next_steps', 'safety_emphasis'],
    forbiddenElements: ['diagnosis', 'prescription_advice'],
    criticality: 'critical',
    expertNotes: 'Summary accuracy is critical. Must bridge to appropriate medical care.'
});

// Add valid transitions with expert validation
MEDICAL_PAIN_ASSESSMENT.addEdge('initial_report', 'agent_pain_inquiry', {
    trigger: 'Patient mentions pain symptoms',
    probability: 0.95,
    qualityMetrics: ['response_time', 'empathy_score', 'clinical_completeness'],
    expertValidation: 'REQUIRED - This transition must happen for proper clinical care'
});

MEDICAL_PAIN_ASSESSMENT.addEdge('agent_pain_inquiry', 'pain_scale_response', {
    trigger: 'Agent asks systematic pain questions',
    probability: 0.85,
    qualityMetrics: ['question_compliance', 'detail_accuracy'],
    expertValidation: 'GOOD - Patients usually respond well to structured questions'
});

// BUSINESS NEGOTIATION DIALOG GRAPH
// ==================================

const BUSINESS_CONTRACT_NEGOTIATION = new DialogGraph(
    'business_contract_negotiation_v1',
    'business',
    'Michael Chen, J.D., Contract Law Expert',
    'Professional contract negotiation conversation flow'
);

BUSINESS_CONTRACT_NEGOTIATION.addNode('initial_proposal', {
    type: 'user_input',
    expectedContent: 'Client presents initial contract terms or requirements',
    expertExample: "We need a service agreement for our quarterly marketing campaign. Budget is $50K, timeline is 3 months, and we need exclusive rights to all creative work.",
    validationRules: {
        shouldContain: ['budget', 'timeline', 'scope'],
        completeness: 'partial_acceptable'
    },
    requiredElements: ['project_scope', 'business_terms'],
    criticality: 'high',
    expertNotes: 'Initial proposals often incomplete - normal and expected'
});

BUSINESS_CONTRACT_NEGOTIATION.addNode('agent_terms_analysis', {
    type: 'agent_response', 
    expectedContent: 'Professional analysis of terms with strategic considerations',
    expertExample: `I understand you're looking for a comprehensive marketing service agreement. Let me review your key terms:

**Scope**: Quarterly marketing campaign
**Budget**: $50,000
**Timeline**: 3 months  
**IP Rights**: Exclusive to client

A few strategic considerations we should discuss:
1. Exclusive IP rights may affect pricing - typically adds 15-25% premium
2. Timeline seems aggressive for comprehensive campaign - let's break down deliverables
3. Budget allocation between creative, media, and execution

Would you like to explore these elements to ensure we structure the best agreement for both parties?`,
    validationRules: {
        mustAcknowledge: 'all_stated_terms',
        mustRaiseConcerns: 'professionally',
        shouldSuggestNextSteps: true,
        tone: 'collaborative_not_adversarial'
    },
    requiredElements: ['term_summary', 'strategic_considerations', 'collaborative_tone'],
    forbiddenElements: ['aggressive_pushback', 'immediate_rejection', 'lawyer_speak'],
    criticality: 'critical',
    expertNotes: 'First response sets negotiation tone. Must be collaborative, not adversarial.'
});

// MIXED DOMAIN: CLINICIAN-BUSINESS OWNER
// ======================================

const CLINICIAN_BUSINESS_TRANSITION = new DialogGraph(
    'clinician_business_context_switch_v1',
    'mixed',
    'Dr. Amanda Rodriguez, Physician & Healthcare Entrepreneur', 
    'Conversation flow when clinician switches between patient care and business management'
);

CLINICIAN_BUSINESS_TRANSITION.addNode('patient_consultation_end', {
    type: 'agent_response',
    expectedContent: 'Wrapping up patient interaction professionally',
    expertExample: "Mrs. Johnson, we have a good treatment plan in place. Please follow up with the front desk to schedule your next appointment in two weeks. Take care.",
    requiredElements: ['clear_conclusion', 'next_steps', 'professional_closure'],
    criticality: 'high',
    domain: 'medical'
});

CLINICIAN_BUSINESS_TRANSITION.addNode('context_switch_request', {
    type: 'user_input',
    expectedContent: 'User indicates need to switch to business matters',
    expertExample: "Can we talk about the quarterly budget review for the practice? I need to make some decisions before the board meeting tomorrow.",
    validationRules: {
        shouldIndicateContextSwitch: true,
        businessTopicClear: true
    },
    criticality: 'medium',
    domain: 'business'
});

CLINICIAN_BUSINESS_TRANSITION.addNode('agent_context_transition', {
    type: 'agent_response',
    expectedContent: 'Smoothly transition from medical to business context while maintaining professionalism',
    expertExample: `Absolutely, Dr. Rodriguez. I understand you need to focus on practice management now. 

Let me switch to business mode - I can see you have the quarterly budget review coming up before tomorrow's board meeting. That's important timing.

What specific budget areas need your attention? I can help analyze the numbers or prepare talking points for the board discussion.`,
    validationRules: {
        acknowledgeContextSwitch: true,
        demonstrateBusinessContext: true,
        maintainProfessional: true,
        offerSpecificHelp: true
    },
    requiredElements: ['context_acknowledgment', 'business_focus', 'specific_assistance'],
    forbiddenElements: ['medical_advice', 'patient_references', 'confusion'],
    criticality: 'critical',
    expertNotes: 'Context switching must be seamless. User should feel companion understands their dual role.',
    domain: 'mixed'
});

// EXPERT VALIDATION FRAMEWORK
// ===========================

class ExpertValidationFramework {
    constructor() {
        this.dialogGraphs = new Map();
        this.expertReviews = new Map();
        this.validationMetrics = new Map();
    }

    /**
     * Register expert-validated dialog graph
     */
    registerDialogGraph(dialogGraph) {
        this.dialogGraphs.set(dialogGraph.graphId, dialogGraph);
        console.log(`✅ Registered expert-validated dialog: ${dialogGraph.graphId}`);
        console.log(`   Expert: ${dialogGraph.expertValidatedBy}`);
        console.log(`   Domain: ${dialogGraph.domain}`);
    }

    /**
     * Run supervised test against dialog graph
     */
    async runSupervisedTest(testConversation, dialogGraphId) {
        const graph = this.dialogGraphs.get(dialogGraphId);
        if (!graph) throw new Error(`Dialog graph ${dialogGraphId} not found`);

        const results = {
            graphId: dialogGraphId,
            expertValidatedBy: graph.expertValidatedBy,
            testResults: [],
            overallScore: 0,
            criticalFailures: [],
            expertRecommendations: []
        };

        // Validate each conversation turn against graph nodes
        for (let i = 0; i < testConversation.length; i++) {
            const turn = testConversation[i];
            const expectedNode = this.findExpectedNode(graph, turn, i);
            
            if (expectedNode) {
                const validation = this.validateTurnAgainstNode(turn, expectedNode);
                results.testResults.push(validation);
                
                if (validation.criticalFailure) {
                    results.criticalFailures.push(validation);
                }
            }
        }

        // Calculate expert-weighted score
        results.overallScore = this.calculateExpertWeightedScore(results.testResults);
        results.expertRecommendations = this.generateExpertRecommendations(results);

        return results;
    }

    /**
     * Validate conversation turn against expert-defined node
     */
    validateTurnAgainstNode(turn, expertNode) {
        const validation = {
            nodeId: expertNode.id,
            turnContent: turn.content,
            passed: true,
            score: 0,
            criticalFailure: false,
            violations: [],
            strengths: [],
            expertNotes: expertNode.expertNotes
        };

        // Check required elements
        for (const required of expertNode.requiredElements || []) {
            if (!this.checkElementPresent(turn.content, required)) {
                validation.violations.push(`Missing required element: ${required}`);
                if (expertNode.criticality === 'critical') {
                    validation.criticalFailure = true;
                }
                validation.passed = false;
            }
        }

        // Check forbidden elements
        for (const forbidden of expertNode.forbiddenElements || []) {
            if (this.checkElementPresent(turn.content, forbidden)) {
                validation.violations.push(`Contains forbidden element: ${forbidden}`);
                if (expertNode.criticality === 'critical') {
                    validation.criticalFailure = true;
                }
                validation.passed = false;
            }
        }

        // Calculate score based on expert criteria
        validation.score = this.calculateNodeScore(turn, expertNode, validation);

        return validation;
    }

    /**
     * Generate expert recommendations for improvement
     */
    generateExpertRecommendations(results) {
        const recommendations = [];
        
        // Critical failures get priority
        if (results.criticalFailures.length > 0) {
            recommendations.push({
                priority: 'CRITICAL',
                recommendation: 'Address critical failures immediately - these violate core professional standards',
                examples: results.criticalFailures.map(f => f.violations).flat()
            });
        }

        // Domain-specific recommendations
        const graph = this.dialogGraphs.get(results.graphId);
        if (graph.domain === 'medical') {
            recommendations.push({
                priority: 'HIGH',
                recommendation: 'Ensure clinical protocols are followed - patient safety depends on systematic approach',
                expertNote: `Per ${graph.expertValidatedBy}: Medical conversations require strict adherence to clinical standards`
            });
        } else if (graph.domain === 'business') {
            recommendations.push({
                priority: 'HIGH', 
                recommendation: 'Maintain professional collaborative tone - adversarial approach damages business relationships',
                expertNote: `Per ${graph.expertValidatedBy}: Business negotiations succeed through collaboration, not confrontation`
            });
        }

        return recommendations;
    }
}

// USAGE EXAMPLE
// =============

const expertFramework = new ExpertValidationFramework();
expertFramework.registerDialogGraph(MEDICAL_PAIN_ASSESSMENT);
expertFramework.registerDialogGraph(BUSINESS_CONTRACT_NEGOTIATION);
expertFramework.registerDialogGraph(CLINICIAN_BUSINESS_TRANSITION);

export { 
    DialogGraph, 
    ExpertValidationFramework,
    MEDICAL_PAIN_ASSESSMENT,
    BUSINESS_CONTRACT_NEGOTIATION,
    CLINICIAN_BUSINESS_TRANSITION
};