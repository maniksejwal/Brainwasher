/**
 * @fileoverview SocialCircle Base Class
 * Unified foundation for Care Circles, Professional Circles, and future circle types
 */

import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

/**
 * SocialCircle - Universal base class for all circle types
 * Handles 90% of common functionality, delegates 10% to context-specific implementations
 */
export class SocialCircle {
    constructor(userId, circleType = 'social', organizationScope = 'intra_org') {
        this.userId = userId;
        this.circleType = circleType;
        this.organizationScope = organizationScope;
        this.config = this.getCircleConfig();
    }

    // ========================================================================
    // CORE CIRCLE MANAGEMENT (Common 90%)
    // ========================================================================

    /**
     * Create a new circle with context-appropriate defaults
     */
    async createCircle(circleConfig) {
        const db = await getDb();
        const circleId = `${this.circleType}_${randomUUID().substring(0, 8)}`;
        
        await db.run(`
            INSERT INTO care_circles (
                circle_id, 
                primary_patient_id,  -- Universal: primary_focus_person_id
                created_at,
                circle_type,
                organization_context,
                coordination_engine
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            circleId,
            circleConfig.primaryUserId || this.userId,
            Date.now(),
            this.circleType,
            JSON.stringify({
                scope: this.organizationScope,
                name: circleConfig.name,
                description: circleConfig.description,
                organizationId: circleConfig.organizationId
            }),
            this.config.coordinationEngine
        ]);

        // Add initial members if provided
        if (circleConfig.members) {
            for (const member of circleConfig.members) {
                await this.addMember(circleId, member.userId, member.role, member.relationshipType);
            }
        }

        return circleId;
    }

    /**
     * Add member to circle (universal method)
     */
    async addMember(circleId, userId, role, relationshipType = 'member') {
        const db = await getDb();
        await db.run(`
            INSERT OR REPLACE INTO care_circle_members (
                circle_id, user_id, role, relationship_type, consent_level
            ) VALUES (?, ?, ?, ?, ?)
        `, [circleId, userId, role, relationshipType, this.config.defaultConsentLevel]);
    }

    /**
     * Remove member from circle
     */
    async removeMember(circleId, userId) {
        const db = await getDb();
        await db.run(`
            DELETE FROM care_circle_members 
            WHERE circle_id = ? AND user_id = ?
        `, [circleId, userId]);
    }

    /**
     * Get circle members with optional filtering
     */
    async getMembers(circleId, filters = {}) {
        const db = await getDb();
        let query = `
            SELECT 
                m.user_id,
                m.role,
                m.relationship_type,
                m.consent_level,
                u.username
            FROM care_circle_members m
            JOIN users u ON m.user_id = u.user_id
            WHERE m.circle_id = ?
        `;
        
        const params = [circleId];

        // Apply filters
        if (filters.role) {
            query += ' AND m.role = ?';
            params.push(filters.role);
        }
        if (filters.relationshipType) {
            query += ' AND m.relationship_type = ?';
            params.push(filters.relationshipType);
        }

        // Apply circle-type-specific sorting
        query += this.getMemberSortingClause();

        return await db.all(query, params);
    }

    /**
     * Send message to circle
     */
    async sendMessage(circleId, content, privacyLevel = 'standard') {
        const db = await getDb();
        await db.run(`
            INSERT INTO messages (
                circle_id, user_id, role, message, 
                privacy_level, criticality_level, timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            circleId, 
            this.userId, 
            await this.getUserRoleInCircle(circleId, this.userId),
            content,
            privacyLevel,
            'normal', 
            Date.now()
        ]);
    }

    /**
     * Update member consent level
     */
    async updateConsent(circleId, userId, consentLevel) {
        const db = await getDb();
        await db.run(`
            UPDATE care_circle_members 
            SET consent_level = ?
            WHERE circle_id = ? AND user_id = ?
        `, [consentLevel, circleId, userId]);
    }

    /**
     * Get user's circles
     */
    async getUserCircles(userId = this.userId) {
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
            WHERE m.user_id = ? AND c.circle_type = ?
            ORDER BY c.created_at DESC
        `, [userId, this.circleType]);
    }

    /**
     * Get basic analytics
     */
    async getAnalytics(circleId) {
        const db = await getDb();
        const memberCount = await db.get(`
            SELECT COUNT(*) as count FROM care_circle_members WHERE circle_id = ?
        `, [circleId]);

        const messageCount = await db.get(`
            SELECT COUNT(*) as count FROM messages WHERE circle_id = ?
        `, [circleId]);

        const recentActivity = await db.all(`
            SELECT timestamp, user_id FROM messages 
            WHERE circle_id = ? 
            ORDER BY timestamp DESC LIMIT 10
        `, [circleId]);

        return {
            memberCount: memberCount.count,
            messageCount: messageCount.count,
            recentActivity,
            circleType: this.circleType,
            organizationScope: this.organizationScope
        };
    }

    // ========================================================================
    // CONTEXT-SPECIFIC IMPLEMENTATIONS (Override these 10%)
    // ========================================================================

    /**
     * Get circle configuration based on circle type
     * Override this method in subclasses for domain-specific behavior
     */
    getCircleConfig() {
        const configs = {
            medical: {
                coordinationEngine: 'medical_care_optimization',
                defaultConsentLevel: 'hipaa_compliant',
                primaryFocus: 'patient_health',
                successMetrics: ['health_outcomes', 'care_adherence'],
                privacyModel: 'medical_privacy'
            },
            professional: {
                coordinationEngine: 'business_coordination_optimization',
                defaultConsentLevel: 'business_standard',
                primaryFocus: 'business_outcomes',
                successMetrics: ['project_completion', 'performance_kpis'],
                privacyModel: 'business_confidentiality'
            },
            social: {
                coordinationEngine: 'social_harmony_optimization',
                defaultConsentLevel: 'personal_preference',
                primaryFocus: 'relationship_maintenance',
                successMetrics: ['engagement_quality', 'social_satisfaction'],
                privacyModel: 'personal_privacy'
            }
        };

        return configs[this.circleType] || configs.social;
    }

    /**
     * Get member sorting clause based on circle type
     * Override this method for domain-specific member ordering
     */
    getMemberSortingClause() {
        const sortingRules = {
            medical: `
                ORDER BY 
                    CASE m.role 
                        WHEN 'patient' THEN 1 
                        WHEN 'doctor' THEN 2
                        WHEN 'caregiver' THEN 3
                        ELSE 4 
                    END
            `,
            professional: `
                ORDER BY 
                    CASE m.relationship_type 
                        WHEN 'target' THEN 1 
                        WHEN 'support' THEN 2
                        WHEN 'expert' THEN 3
                        ELSE 4 
                    END
            `,
            social: `
                ORDER BY m.role, u.username
            `
        };

        return sortingRules[this.circleType] || sortingRules.social;
    }

    /**
     * Validate circle pattern based on circle type
     * Override this method for domain-specific validation rules
     */
    async validateCirclePattern(circleId) {
        const members = await this.getMembers(circleId);
        
        // Default validation: minimum 2 members
        if (members.length < 2) {
            return { 
                valid: false, 
                reason: `Circle has ${members.length} members, need minimum 2` 
            };
        }

        return { valid: true, members };
    }

    /**
     * Calculate optimal outcome based on circle type
     * Override this method for domain-specific optimization
     */
    async calculateOptimalOutcome(circleId, goal) {
        // Base implementation - subclasses should override
        return {
            strategy: 'collaborative_consensus',
            confidence: 0.7,
            recommendation: 'Continue with current approach',
            circleType: this.circleType
        };
    }

    /**
     * Escalate issue based on circle type
     * Override this method for domain-specific escalation rules
     */
    async escalateIssue(circleId, issue, severity = 'normal') {
        const db = await getDb();
        await db.run(`
            INSERT INTO escalations (circle_id, type, details, timestamp)
            VALUES (?, ?, ?, ?)
        `, [circleId, issue.type, JSON.stringify(issue), Date.now()]);
        
        return { escalated: true, severity, circleType: this.circleType };
    }

    // ========================================================================
    // UTILITY METHODS
    // ========================================================================

    async getUserRoleInCircle(circleId, userId) {
        const db = await getDb();
        const result = await db.get(`
            SELECT role FROM care_circle_members 
            WHERE circle_id = ? AND user_id = ?
        `, [circleId, userId]);
        return result?.role || 'member';
    }

    getCoordinationEngine() {
        const engines = {
            'intra_org': 'internal_optimization',
            'inter_org': 'negotiated_optimization', 
            'hybrid': 'adaptive_optimization'
        };
        return engines[this.organizationScope] || 'internal_optimization';
    }
}