/**
 * @fileoverview Business Coordination Engine
 * Internal organizational optimization (within-company coordination)
 */

import { getDb } from '../../db/connection.js';
import { randomUUID } from 'crypto';

/**
 * Business Coordination Engine - Optimizes within organization
 * Unlike negotiation agents (cross-organizational), this coordinates internal teams
 */
export class BusinessCoordinationEngine {
    constructor(circleId, organizationId) {
        this.circleId = circleId;
        this.organizationId = organizationId;
        this.optimizationScope = 'within_organization'; // Key difference from negotiations
    }

    /**
     * COORDINATION OPTIMIZATION ALGORITHMS
     * Different from negotiation (which is competitive/adversarial)
     * This is collaborative optimization within the same organization
     */

    /**
     * Resource Allocation Optimization
     * Distribute team resources based on priorities and availability
     */
    async optimizeResourceAllocation(projectRequirements) {
        const db = await getDb();
        
        // Get circle members with their roles and current workload
        const members = await db.all(`
            SELECT ccm.user_id, ccm.role, ccm.relationship_type,
                   oh.authority_level, oh.department, oh.title,
                   u.username
            FROM care_circle_members ccm
            JOIN users u ON ccm.user_id = u.user_id
            LEFT JOIN org_hierarchies oh ON ccm.user_id = oh.user_id
            WHERE ccm.circle_id = ? AND oh.org_id = ?
        `, [this.circleId, this.organizationId]);

        // Optimization algorithm for internal resource allocation
        const allocation = this.calculateOptimalResourceAllocation(members, projectRequirements);
        
        // Log coordination decision for audit
        await this.logCoordinationDecision('resource_allocation', allocation);
        
        return allocation;
    }

    /**
     * Meeting Scheduling Optimization  
     * Find optimal meeting times considering all circle members' availability
     */
    async optimizeMeetingScheduling(meetingRequirements) {
        const members = await this.getCircleMembers();
        
        // Algorithm: Find time slots that work for required attendees
        const optimalSchedule = this.calculateOptimalMeetingTime(members, meetingRequirements);
        
        await this.logCoordinationDecision('meeting_scheduling', optimalSchedule);
        
        return optimalSchedule;
    }

    /**
     * Approval Workflow Optimization
     * Route decisions through proper organizational hierarchy
     */
    async optimizeApprovalWorkflow(decision, amount = 0) {
        const db = await getDb();
        
        // Get approval authorities within the circle
        const approvers = await db.all(`
            SELECT ccm.user_id, ccm.role, 
                   rd.approval_authority, rd.permissions,
                   u.username
            FROM care_circle_members ccm
            JOIN org_hierarchies oh ON ccm.user_id = oh.user_id  
            JOIN role_definitions rd ON oh.role = rd.id
            JOIN users u ON ccm.user_id = u.user_id
            WHERE ccm.circle_id = ? AND oh.org_id = ?
            ORDER BY rd.approval_authority DESC
        `, [this.circleId, this.organizationId]);

        // Optimization: Find minimal approval path that meets requirements
        const approvalFlow = this.calculateOptimalApprovalPath(approvers, decision, amount);
        
        await this.logCoordinationDecision('approval_workflow', approvalFlow);
        
        return approvalFlow;
    }

    /**
     * Communication Flow Optimization
     * Ensure information flows efficiently within the circle
     */
    async optimizeCommunicationFlow(information, urgency = 'normal') {
        const members = await this.getCircleMembers();
        
        // Optimization: Who needs to know what, when, and how?
        const communicationPlan = this.calculateOptimalCommunicationFlow(
            members, 
            information, 
            urgency
        );
        
        await this.logCoordinationDecision('communication_flow', communicationPlan);
        
        return communicationPlan;
    }

    /**
     * Budget Optimization Within Circle
     * Allocate budget across circle activities for maximum organizational benefit
     */
    async optimizeBudgetAllocation(availableBudget, requests) {
        const members = await this.getCircleMembers();
        
        // Internal optimization algorithm (NOT competitive like negotiations)
        const budgetAllocation = this.calculateOptimalBudgetDistribution(
            availableBudget,
            requests,
            members
        );

        await this.logCoordinationDecision('budget_allocation', budgetAllocation);
        
        return budgetAllocation;
    }

    /**
     * OPTIMIZATION ALGORITHMS (INTERNAL COORDINATION)
     * These are collaborative, not competitive like negotiations
     */

    calculateOptimalResourceAllocation(members, requirements) {
        // Algorithm: Maximize team efficiency within organizational constraints
        const allocation = {
            assignments: [],
            efficiency_score: 0,
            coordination_benefits: []
        };

        for (const requirement of requirements) {
            // Find best internal resource match
            const bestMatch = members.find(member => 
                this.skillMatch(member, requirement) && 
                this.availabilityMatch(member, requirement) &&
                this.authorityMatch(member, requirement)
            );

            if (bestMatch) {
                allocation.assignments.push({
                    requirement: requirement.task,
                    assigned_to: bestMatch.username,
                    role: bestMatch.role,
                    efficiency_gain: this.calculateEfficiencyGain(bestMatch, requirement)
                });
            }
        }

        allocation.efficiency_score = this.calculateTeamEfficiencyScore(allocation.assignments);
        
        return allocation;
    }

    calculateOptimalMeetingTime(members, requirements) {
        // Algorithm: Maximize attendance while respecting hierarchy preferences
        const timeSlots = this.generateTimeSlots(requirements.duration, requirements.timeframe);
        let bestSlot = null;
        let bestScore = -1;

        for (const slot of timeSlots) {
            const attendanceScore = this.calculateAttendanceScore(members, slot);
            const hierarchyScore = this.calculateHierarchyScore(members, slot);
            const urgencyScore = this.calculateUrgencyScore(requirements, slot);
            
            const totalScore = attendanceScore + hierarchyScore + urgencyScore;
            
            if (totalScore > bestScore) {
                bestScore = totalScore;
                bestSlot = slot;
            }
        }

        return {
            optimal_time: bestSlot,
            expected_attendance: this.calculateExpectedAttendance(members, bestSlot),
            coordination_benefits: this.calculateMeetingBenefits(bestSlot, members),
            efficiency_score: bestScore
        };
    }

    calculateOptimalApprovalPath(approvers, decision, amount) {
        // Algorithm: Minimize approval time while meeting governance requirements
        const requiredApprovers = approvers.filter(approver => 
            approver.approval_authority >= amount ||
            this.hasDecisionPermission(approver, decision.type)
        );

        // Sort by efficiency: authority level vs typical approval speed
        requiredApprovers.sort((a, b) => {
            const efficiencyA = a.approval_authority / this.getApprovalTime(a);
            const efficiencyB = b.approval_authority / this.getApprovalTime(b);
            return efficiencyB - efficiencyA;
        });

        return {
            approval_path: requiredApprovers.map(a => ({
                approver: a.username,
                role: a.role,
                authority_level: a.approval_authority,
                estimated_time: this.getApprovalTime(a)
            })),
            total_estimated_time: requiredApprovers.reduce((sum, a) => sum + this.getApprovalTime(a), 0),
            coordination_benefits: ['faster_decision_making', 'proper_governance', 'audit_compliance']
        };
    }

    calculateOptimalCommunicationFlow(members, information, urgency) {
        // Algorithm: Ensure right information reaches right people at right time
        const communicationPlan = {
            immediate_notifications: [],
            scheduled_updates: [],
            need_to_know_basis: [],
            coordination_benefits: []
        };

        for (const member of members) {
            const relevanceScore = this.calculateInformationRelevance(member, information);
            const urgencyThreshold = this.getUrgencyThreshold(member.role);

            if (urgency === 'critical' || relevanceScore > 0.8) {
                communicationPlan.immediate_notifications.push({
                    recipient: member.username,
                    method: 'direct_message',
                    reason: 'high_relevance_or_critical_urgency'
                });
            } else if (relevanceScore > 0.4) {
                communicationPlan.scheduled_updates.push({
                    recipient: member.username,
                    method: 'circle_message',
                    schedule: 'next_business_hour'
                });
            } else if (relevanceScore > 0.1) {
                communicationPlan.need_to_know_basis.push({
                    recipient: member.username,
                    method: 'summary_notification',
                    trigger: 'when_directly_relevant'
                });
            }
        }

        return communicationPlan;
    }

    /**
     * HELPER METHODS
     */

    async getCircleMembers() {
        const db = await getDb();
        return await db.all(`
            SELECT ccm.user_id, ccm.role, ccm.relationship_type,
                   oh.authority_level, oh.department, oh.title,
                   u.username
            FROM care_circle_members ccm
            JOIN users u ON ccm.user_id = u.user_id
            LEFT JOIN org_hierarchies oh ON ccm.user_id = oh.user_id
            WHERE ccm.circle_id = ? AND (oh.org_id = ? OR oh.org_id IS NULL)
        `, [this.circleId, this.organizationId]);
    }

    async logCoordinationDecision(decision_type, decision_data) {
        const db = await getDb();
        await db.run(`
            INSERT INTO autonomous_actions (
                id, user_id, action_type, metadata, 
                privacy_level, autonomy_level, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
            randomUUID(),
            'business_coordination_engine',
            decision_type,
            JSON.stringify({
                circle_id: this.circleId,
                organization_id: this.organizationId,
                decision_data,
                optimization_scope: 'within_organization'
            }),
            'internal',
            'autonomous',
            Date.now()
        ]);
    }

    // Utility methods for optimization calculations
    skillMatch(member, requirement) {
        // Check if member's role/skills match the requirement
        return member.role === requirement.required_role || 
               member.department === requirement.required_department;
    }

    availabilityMatch(member, requirement) {
        // Check if member is available (simplified)
        return true; // Would integrate with calendar/workload system
    }

    authorityMatch(member, requirement) {
        // Check if member has authority for this requirement
        return member.authority_level >= (requirement.required_authority || 0);
    }

    calculateEfficiencyGain(member, requirement) {
        // Calculate efficiency gain from this assignment
        return member.authority_level * 0.1 + (this.skillMatch(member, requirement) ? 0.5 : 0);
    }

    calculateTeamEfficiencyScore(assignments) {
        return assignments.reduce((sum, assignment) => sum + assignment.efficiency_gain, 0);
    }

    generateTimeSlots(duration, timeframe) {
        // Generate possible meeting time slots
        return [
            { start: '09:00', end: '10:00', day: 'tomorrow' },
            { start: '14:00', end: '15:00', day: 'tomorrow' },
            { start: '10:00', end: '11:00', day: 'day_after_tomorrow' }
        ]; // Simplified
    }

    calculateAttendanceScore(members, slot) {
        // How many key members can attend this slot?
        return members.filter(m => this.isAvailable(m, slot)).length / members.length;
    }

    calculateHierarchyScore(members, slot) {
        // Prefer times when senior members are available
        const seniorMembers = members.filter(m => m.authority_level > 5);
        const availableSenior = seniorMembers.filter(m => this.isAvailable(m, slot));
        return availableSenior.length / Math.max(seniorMembers.length, 1);
    }

    calculateUrgencyScore(requirements, slot) {
        // Earlier times get higher urgency scores
        const hoursFromNow = this.calculateHoursFromNow(slot);
        return Math.max(0, 1 - (hoursFromNow / 48)); // Prefer within 48 hours
    }

    isAvailable(member, slot) {
        // Check member availability (simplified)
        return Math.random() > 0.3; // 70% availability rate
    }

    calculateExpectedAttendance(members, slot) {
        return members.filter(m => this.isAvailable(m, slot)).map(m => ({
            name: m.username,
            role: m.role,
            authority: m.authority_level
        }));
    }

    calculateMeetingBenefits(slot, members) {
        return [
            'optimal_team_coordination',
            'efficient_time_utilization', 
            'maximum_stakeholder_participation'
        ];
    }

    hasDecisionPermission(approver, decisionType) {
        // Check if approver has permission for this type of decision
        try {
            const permissions = JSON.parse(approver.permissions || '[]');
            return permissions.includes('all') || permissions.includes(decisionType);
        } catch {
            return false;
        }
    }

    getApprovalTime(approver) {
        // Estimate approval time based on role/authority
        return approver.authority_level > 8 ? 24 : 4; // Hours
    }

    calculateInformationRelevance(member, information) {
        // Calculate how relevant this information is to this member
        let relevance = 0;
        
        if (information.department === member.department) relevance += 0.6;
        if (information.role_specific && information.role_specific.includes(member.role)) relevance += 0.4;
        if (information.authority_required <= member.authority_level) relevance += 0.3;
        
        return Math.min(relevance, 1.0);
    }

    getUrgencyThreshold(role) {
        // Different roles have different urgency thresholds
        const thresholds = {
            'project_manager': 0.3,
            'executive_sponsor': 0.6,
            'team_member': 0.2,
            'consultant': 0.4
        };
        return thresholds[role] || 0.3;
    }

    calculateHoursFromNow(slot) {
        // Calculate hours between now and the slot (simplified)
        const dayMultiplier = slot.day === 'tomorrow' ? 24 : 48;
        const slotHour = parseInt(slot.start.split(':')[0]);
        return dayMultiplier + slotHour - new Date().getHours();
    }
}