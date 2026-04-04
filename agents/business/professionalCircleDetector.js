/**
 * @fileoverview Professional Circle Detection and Routing
 * Detects when care circles are being used for business/professional purposes
 */

/**
 * Determine if a circle is being used for professional/business coordination
 * vs medical care coordination
 */
export function detectCircleContext(circleMembers, recentMessages, circleMetadata) {
    const contextSignals = {
        medical: 0,
        business: 0,
        mixed: 0
    };

    // Analyze member roles
    for (const member of circleMembers) {
        if (member.role.match(/patient|caregiver|doctor|nurse|specialist/i)) {
            contextSignals.medical += 0.4;
        }
        
        if (member.role.match(/manager|executive|analyst|consultant|coordinator|director/i)) {
            contextSignals.business += 0.4;
        }

        if (member.role.match(/clinician|physician.*entrepreneur|medical.*director/i)) {
            contextSignals.mixed += 0.3;
        }

        // Analyze relationship types
        if (member.relationship_type?.match(/family|medical|healthcare/i)) {
            contextSignals.medical += 0.2;
        }
        
        if (member.relationship_type?.match(/direct_report|consultant|client|vendor|colleague/i)) {
            contextSignals.business += 0.2;
        }
    }

    // Analyze recent messages for context clues
    for (const message of recentMessages.slice(-10)) {
        const businessKeywords = [
            'budget', 'project', 'deadline', 'meeting', 'proposal', 'contract',
            'revenue', 'client', 'vendor', 'quarterly', 'approval', 'resources',
            'timeline', 'deliverable', 'stakeholder', 'performance', 'metrics'
        ];

        const medicalKeywords = [
            'symptoms', 'medication', 'treatment', 'diagnosis', 'appointment',
            'pain', 'prescription', 'therapy', 'condition', 'health', 'doctor',
            'hospital', 'urgent', 'emergency', 'care', 'patient'
        ];

        const messageText = message.message.toLowerCase();
        
        businessKeywords.forEach(keyword => {
            if (messageText.includes(keyword)) {
                contextSignals.business += 0.1;
            }
        });

        medicalKeywords.forEach(keyword => {
            if (messageText.includes(keyword)) {
                contextSignals.medical += 0.1;
            }
        });
    }

    // Determine context
    const maxSignal = Math.max(contextSignals.medical, contextSignals.business, contextSignals.mixed);
    
    if (contextSignals.mixed === maxSignal) {
        return 'mixed'; // Dual-role professional (e.g., clinician-business owner)
    } else if (contextSignals.business === maxSignal) {
        return 'professional'; // Business/professional circle
    } else {
        return 'medical'; // Traditional care circle
    }
}

/**
 * Get coordination engine based on circle context
 */
export function getCoordinationEngine(circleId, context, organizationId = null) {
    switch (context) {
        case 'professional':
            return new BusinessCoordinationEngine(circleId, organizationId);
        case 'mixed':
            // Dual-context engine that can switch between medical and business coordination
            return new DualContextCoordinationEngine(circleId, organizationId);
        case 'medical':
        default:
            // Return existing medical care coordination (handled by medical agents)
            return null;
    }
}

/**
 * Dual-context coordination engine for mixed professional/medical circles
 */
class DualContextCoordinationEngine {
    constructor(circleId, organizationId) {
        this.circleId = circleId;
        this.organizationId = organizationId;
        this.businessEngine = new BusinessCoordinationEngine(circleId, organizationId);
        this.currentContext = 'medical'; // Default to medical priority
    }

    async switchContext(newContext, reason) {
        const previousContext = this.currentContext;
        this.currentContext = newContext;
        
        await this.logContextSwitch(previousContext, newContext, reason);
        
        return {
            switched_from: previousContext,
            switched_to: newContext,
            reason,
            coordination_approach: this.getCoordinationApproach(newContext)
        };
    }

    async coordinate(request) {
        if (this.currentContext === 'business') {
            // Use business coordination for efficiency and resource optimization
            return await this.businessEngine.optimizeResourceAllocation(request);
        } else {
            // Use medical care coordination (empathy, patient safety first)
            return await this.coordinateMedicalCare(request);
        }
    }

    getCoordinationApproach(context) {
        return {
            medical: {
                priority: 'patient_safety_and_care',
                optimization: 'health_outcomes',
                communication: 'empathetic_and_supportive',
                decision_making: 'collaborative_with_patient_consent'
            },
            business: {
                priority: 'organizational_efficiency_and_results',
                optimization: 'resource_utilization_and_roi',
                communication: 'strategic_and_results_focused',
                decision_making: 'hierarchical_with_business_logic'
            }
        }[context];
    }

    async logContextSwitch(from, to, reason) {
        const db = await getDb();
        await db.run(`
            INSERT INTO autonomous_actions (
                id, user_id, action_type, metadata, 
                privacy_level, autonomy_level, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            randomUUID(),
            'dual_context_coordination_engine',
            'context_switch',
            JSON.stringify({
                circle_id: this.circleId,
                from_context: from,
                to_context: to,
                reason,
                timestamp: Date.now()
            }),
            'internal',
            'supervised',
            Date.now()
        ]);
    }

    async coordinateMedicalCare(request) {
        // Delegate to existing medical care coordination
        return {
            coordination_type: 'medical_care',
            approach: 'patient_centered',
            message: 'Routing to medical care coordination with patient safety priority'
        };
    }
}

export { DualContextCoordinationEngine };