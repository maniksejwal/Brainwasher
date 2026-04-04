/**
 * @fileoverview Specialized Circle Managers
 * Domain-specific implementations inheriting from SocialCircle base class
 */

import { SocialCircle } from './SocialCircle.js';

// ============================================================================
// MEDICAL CARE CIRCLE MANAGER
// ============================================================================

class CareCircleManager extends SocialCircle {
    constructor(userId) {
        super(userId, 'medical', 'inter_org'); // Medical care often spans organizations
    }

    /**
     * Medical-specific circle validation
     */
    async validateCirclePattern(circleId) {
        const members = await this.getMembers(circleId);
        
        // Medical circles need at least patient + caregiver or patient + doctor
        if (members.length < 2) {
            return { 
                valid: false, 
                reason: `Medical circle needs minimum 2 members (patient + caregiver/doctor)` 
            };
        }

        const roles = members.map(m => m.role.toLowerCase());
        const hasPatient = roles.includes('patient');
        const hasCareProvider = roles.some(role => 
            ['doctor', 'nurse', 'caregiver', 'specialist'].includes(role)
        );

        if (!hasPatient) {
            return { valid: false, reason: 'Medical circle must include a patient' };
        }

        if (!hasCareProvider) {
            return { valid: false, reason: 'Medical circle must include at least one care provider' };
        }

        return { valid: true, members, patientCount: 1, careProviders: members.length - 1 };
    }

    /**
     * Medical-specific optimization (care coordination)
     */
    async calculateOptimalOutcome(circleId, goal) {
        const members = await this.getMembers(circleId);
        
        // Medical optimization focuses on patient outcomes
        if (goal === 'care_coordination') {
            return {
                strategy: 'patient_centered_care_team_coordination',
                confidence: 0.9,
                recommendation: 'Prioritize patient safety and care continuity',
                primaryCaregiver: members.find(m => m.role === 'doctor')?.user_id,
                secondarySupport: members.filter(m => m.role !== 'patient' && m.role !== 'doctor'),
                circleType: this.circleType
            };
        }

        return super.calculateOptimalOutcome(circleId, goal);
    }

    /**
     * Medical-specific escalation (health emergencies)
     */
    async escalateIssue(circleId, issue, severity = 'normal') {
        // Medical escalations prioritize immediate health risks
        if (severity === 'emergency' || issue.type === 'health_emergency') {
            const members = await this.getMembers(circleId);
            const doctors = members.filter(m => m.role === 'doctor');
            
            // Notify all doctors immediately for health emergencies
            await super.escalateIssue(circleId, {
                ...issue,
                urgentNotification: doctors.map(d => d.user_id),
                priority: 'critical'
            }, 'emergency');

            return { escalated: true, severity: 'emergency', notifiedProviders: doctors.length };
        }

        return super.escalateIssue(circleId, issue, severity);
    }
}

// ============================================================================
// PROFESSIONAL CIRCLE MANAGER  
// ============================================================================

class ProfessionalCircleManager extends SocialCircle {
    constructor(userId) {
        super(userId, 'professional', 'intra_org'); // Professional circles often within org
    }

    /**
     * Professional-specific circle validation (Target + Support + Expert minimum)
     */
    async validateCirclePattern(circleId) {
        const members = await this.getMembers(circleId);
        
        if (members.length < 3) {
            return { 
                valid: false, 
                reason: `Professional circle needs minimum 3 members (Target + Support + Expert), has ${members.length}` 
            };
        }

        const relationshipTypes = members.map(m => m.relationship_type);
        const coreRoles = ['target', 'support', 'expert'];
        const missingRoles = coreRoles.filter(role => !relationshipTypes.includes(role));
        
        if (missingRoles.length > 0) {
            return { 
                valid: false, 
                reason: `Missing core professional roles: ${missingRoles.join(', ')}` 
            };
        }

        return { 
            valid: true, 
            members,
            coreTeam: members.filter(m => coreRoles.includes(m.relationship_type)),
            additionalMembers: members.filter(m => !coreRoles.includes(m.relationship_type))
        };
    }

    /**
     * Professional-specific optimization (business outcomes)
     */
    async calculateOptimalOutcome(circleId, goal) {
        const members = await this.getMembers(circleId);
        
        if (goal === 'project_delivery') {
            const target = members.find(m => m.relationship_type === 'target');
            const support = members.find(m => m.relationship_type === 'support');
            const expert = members.find(m => m.relationship_type === 'expert');

            return {
                strategy: 'target_support_expert_coordination',
                confidence: 0.85,
                recommendation: 'Focus on target-defined outcomes with expert guidance',
                decisionMaker: target?.user_id,
                coordinator: support?.user_id,
                technicalLead: expert?.user_id,
                circleType: this.circleType
            };
        }

        return super.calculateOptimalOutcome(circleId, goal);
    }

    /**
     * Create professional circle with Target + Support + Expert pattern
     */
    async createProfessionalCircle(circleConfig) {
        const enhancedConfig = {
            ...circleConfig,
            members: [
                { userId: circleConfig.members.target.userId, role: circleConfig.members.target.role, relationshipType: 'target' },
                { userId: circleConfig.members.support.userId, role: circleConfig.members.support.role, relationshipType: 'support' },
                { userId: circleConfig.members.expert.userId, role: circleConfig.members.expert.role, relationshipType: 'expert' }
            ]
        };

        return await this.createCircle(enhancedConfig);
    }

    /**
     * Add additional member beyond core 3-person team
     */
    async addAdditionalMember(circleId, userId, role, relationshipType = 'additional') {
        const validation = await this.validateCirclePattern(circleId);
        
        if (!validation.valid) {
            throw new Error(`Cannot add member to invalid circle: ${validation.reason}`);
        }
        
        await this.addMember(circleId, userId, role, relationshipType);
        
        return {
            success: true,
            circleId,
            newMember: { userId, role, relationshipType },
            totalMembers: validation.members.length + 1
        };
    }
}

// ============================================================================
// SOCIAL CIRCLE MANAGER (Pure social relationships)
// ============================================================================

class SocialCircleManager extends SocialCircle {
    constructor(userId) {
        super(userId, 'social', 'inter_org'); // Social circles cross organizations
    }

    /**
     * Social-specific validation (very flexible)
     */
    async validateCirclePattern(circleId) {
        const members = await this.getMembers(circleId);
        
        // Social circles just need at least 2 people to be "social"
        if (members.length < 2) {
            return { 
                valid: false, 
                reason: `Social circle needs at least 2 members for social interaction, has ${members.length}` 
            };
        }

        return { 
            valid: true, 
            members,
            socialDynamics: this.analyzeSocialDynamics(members)
        };
    }

    /**
     * Analyze social relationships and dynamics
     */
    analyzeSocialDynamics(members) {
        const relationships = members.map(m => m.relationship_type);
        const closeFriends = relationships.filter(r => r === 'close_friend').length;
        const family = relationships.filter(r => r === 'family').length;
        const colleagues = relationships.filter(r => r === 'professional').length;

        return {
            closeFriends,
            family,
            colleagues,
            totalSize: members.length,
            intimacyLevel: closeFriends > family ? 'friendship_focused' : family > 0 ? 'family_focused' : 'mixed'
        };
    }

    /**
     * Social-specific optimization (relationship harmony)
     */
    async calculateOptimalOutcome(circleId, goal) {
        const members = await this.getMembers(circleId);
        const dynamics = this.analyzeSocialDynamics(members);
        
        if (goal === 'social_harmony') {
            return {
                strategy: 'inclusive_social_facilitation',
                confidence: 0.75,
                recommendation: `Focus on ${dynamics.intimacyLevel} activities with ${members.length} participants`,
                socialDynamics: dynamics,
                circleType: this.circleType
            };
        }

        return super.calculateOptimalOutcome(circleId, goal);
    }
}

// ============================================================================  
// UNIFIED EXPORT (Backward Compatibility)
// ============================================================================

// Export with original names for backward compatibility
export { CareCircleManager as MedicalCircleManager };

// Current exports
export { ProfessionalCircleManager, CareCircleManager, SocialCircleManager };