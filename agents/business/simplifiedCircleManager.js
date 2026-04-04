/**
 * @fileoverview Simplified Professional Circle Manager
 * General Target + Support + Expert pattern without predefined archetypes
 */

import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

export class ProfessionalCircleManager {
    constructor(userId) {
        this.userId = userId;
    }

    /**
     * Create a professional circle with flexible Target + Support + Expert pattern
     * @param {Object} circleConfig - Configuration for the professional circle
     * @param {string} circleConfig.name - Circle name (user-defined)
     * @param {string} circleConfig.organizationContext - 'within_org', 'across_org', 'hybrid'
     * @param {Object} circleConfig.members - {target: {userId, role}, support: {userId, role}, expert: {userId, role}}
     * @param {string} circleConfig.description - Circle description
     * @param {string} circleConfig.organizationId - Primary organization ID (optional)
     */
    async createProfessionalCircle(circleConfig) {
        const db = await getDb();
        const circleId = `circle_${randomUUID().substring(0, 8)}`;
        
        const coordinationEngine = this.getCoordinationEngine(circleConfig.organizationContext);
        
        // Create the circle (reusing care_circles table with professional context)
        await db.run(`
            INSERT INTO care_circles (
                circle_id, 
                primary_patient_id,  -- In professional context: target person
                created_at,
                circle_type,
                organization_context,
                coordination_engine
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            circleId,
            circleConfig.members.target.userId, // Target person is the "primary focus"
            Date.now(),
            'professional', // Generic professional circle
            JSON.stringify({
                scope: circleConfig.organizationContext,
                organizationId: circleConfig.organizationId,
                name: circleConfig.name,
                description: circleConfig.description
            }),
            coordinationEngine
        ]);

        // Add the 3 members with user-defined roles
        await this.addCircleMember(
            circleId, 
            circleConfig.members.target.userId, 
            circleConfig.members.target.role, 
            'target'
        );
        await this.addCircleMember(
            circleId, 
            circleConfig.members.support.userId, 
            circleConfig.members.support.role, 
            'support'
        );
        await this.addCircleMember(
            circleId, 
            circleConfig.members.expert.userId, 
            circleConfig.members.expert.role, 
            'expert'
        );

        return circleId;
    }

    /**
     * Add a member to a professional circle
     */
    async addCircleMember(circleId, userId, role, relationshipType) {
        const db = await getDb();
        await db.run(`
            INSERT OR REPLACE INTO care_circle_members (
                circle_id, user_id, role, relationship_type, consent_level
            ) VALUES (?, ?, ?, ?, ?)
        `, [circleId, userId, role, relationshipType, 'business_standard']);
    }

    /**
     * Get coordination engine based on organizational context
     */
    getCoordinationEngine(organizationContext) {
        const engines = {
            'within_org': 'internal_optimization',
            'across_org': 'negotiated_optimization', 
            'hybrid': 'adaptive_optimization',
            'crisis': 'crisis_authority'
        };
        return engines[organizationContext] || 'internal_optimization';
    }

    /**
     * Get all professional circles for a user
     */
    async getUserProfessionalCircles(userId) {
        const db = await getDb();
        return await db.all(`
            SELECT 
                c.circle_id,
                c.circle_type,
                c.organization_context,
                c.coordination_engine,
                c.created_at,
                m.role,
                m.relationship_type
            FROM care_circles c
            JOIN care_circle_members m ON c.circle_id = m.circle_id
            WHERE m.user_id = ? AND c.circle_type = 'professional'
            ORDER BY c.created_at DESC
        `, [userId]);
    }

    /**
     * Get circle members with their roles (always 3: target, support, expert)
     */
    async getCircleMembers(circleId) {
        const db = await getDb();
        return await db.all(`
            SELECT 
                m.user_id,
                m.role,
                m.relationship_type,
                u.username
            FROM care_circle_members m
            JOIN users u ON m.user_id = u.user_id
            WHERE m.circle_id = ?
            ORDER BY 
                CASE m.relationship_type 
                    WHEN 'target' THEN 1 
                    WHEN 'support' THEN 2
                    WHEN 'expert' THEN 3
                    ELSE 4
                END
        `, [circleId]);
    }

    /**
     * Get suggested circle templates (optional helpers)
     */
    getSuggestedTemplates() {
        return [
            {
                name: "Sales Deal",
                targetRole: "Buyer",
                supportRole: "Champion", 
                expertRole: "Account Manager",
                description: "Core 3-person sales team (additional members can be added)"
            },
            {
                name: "Project Team",
                targetRole: "Project Owner",
                supportRole: "Project Manager",
                expertRole: "Technical Lead", 
                description: "Core 3-person project team (additional members can be added)"
            },
            {
                name: "Custom Circle",
                targetRole: "Decision Maker",
                supportRole: "Coordinator",
                expertRole: "Specialist",
                description: "Core 3-person team with flexible roles (additional members can be added)"
            }
        ];
    }

    /**
     * Add additional member to existing circle (beyond core Target + Support + Expert)
     */
    async addAdditionalMember(circleId, userId, role, relationshipType = 'additional') {
        const validation = await this.validateCirclePattern(circleId);
        
        if (!validation.valid) {
            throw new Error(`Cannot add member to invalid circle: ${validation.reason}`);
        }
        
        await this.addCircleMember(circleId, userId, role, relationshipType);
        
        return {
            success: true,
            circleId,
            newMember: { userId, role, relationshipType },
            totalMembers: validation.members.length + 1
        };
    }

    /**
     * Support backward compatibility with existing care circles
     * Medical circles use: patient, caregiver, doctor roles
     * Professional circles use: target, support, expert roles
     */
    async convertMedicalToProfessionalContext(circleId, mappings) {
        const db = await getDb();
        
        // Update circle type if it's medical
        await db.run(`
            UPDATE care_circles 
            SET circle_type = 'professional',
                organization_context = ?,
                coordination_engine = 'internal_optimization'
            WHERE circle_id = ? AND circle_type = 'medical'
        `, [
            JSON.stringify({ scope: 'within_org', converted: true }),
            circleId
        ]);

        // Optionally update member roles based on provided mappings
        if (mappings) {
            for (const [oldRole, newRole] of Object.entries(mappings)) {
                await db.run(`
                    UPDATE care_circle_members 
                    SET role = ?, relationship_type = ?
                    WHERE circle_id = ? AND role = ?
                `, [newRole.role, newRole.relationshipType, circleId, oldRole]);
            }
        }

        return { success: true, circleId, updated: true };
    }

    /**
     * Validate circle has Target + Support + Expert roles (minimum viable team)
     * Additional members beyond 3 are allowed
     */
    async validateCirclePattern(circleId) {
        const members = await this.getCircleMembers(circleId);
        
        if (members.length < 3) {
            return { valid: false, reason: `Circle has ${members.length} members, need minimum 3 (Target + Support + Expert)` };
        }

        const relationshipTypes = members.map(m => m.relationship_type);
        const coreRoles = ['target', 'support', 'expert'];
        
        // Check that we have AT LEAST one of each core role
        const missingRoles = coreRoles.filter(role => !relationshipTypes.includes(role));
        
        if (missingRoles.length > 0) {
            return { valid: false, reason: `Missing core roles: ${missingRoles.join(', ')}` };
        }

        return { 
            valid: true, 
            members,
            coreTeam: members.filter(m => coreRoles.includes(m.relationship_type)),
            additionalMembers: members.filter(m => !coreRoles.includes(m.relationship_type))
        };
    }
}