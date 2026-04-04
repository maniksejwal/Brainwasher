#!/usr/bin/env node

/**
 * Care Circle CLI Simulation - Backward Compatibility Testing
 * Tests existing medical care functionality works with new SocialCircle base class
 */

import { getDb } from '../db/connection.js';
import { initializeDatabase } from '../db/schema.js';
import { addUser, createCareCircle, addMemberToCircle, getCircleMembers } from '../db/index.js';
import { CareCircleManager } from '../agents/social/SpecializedCircleManagers.js';
import { randomUUID } from 'crypto';

class CareCircleSimulation {
    constructor() {
        this.circleId = null;
        this.members = [];
        this.simulationData = {
            messagesCount: 0,
            escalationsCount: 0,
            medicationChecks: 0,
            emergencyAlerts: 0
        };
    }

    async initialize() {
        console.log('🏥 CARE CIRCLE CLI SIMULATION');
        console.log('===============================\n');
        
        await initializeDatabase();
        console.log('✅ Database initialized');
    }

    async setupMedicalScenario() {
        console.log('\n📋 Setting up medical scenario...');
        
        // Create realistic medical care team
        const users = [
            { id: 'patient_diabetes_001', name: 'Sarah Johnson', role: 'patient' },
            { id: 'caregiver_spouse_001', name: 'Mike Johnson', role: 'caregiver' },
            { id: 'doctor_primary_001', name: 'Dr. Emily Chen', role: 'doctor' },
            { id: 'nurse_diabetes_001', name: 'Nurse Patricia Wong', role: 'nurse' },
            { id: 'specialist_endo_001', name: 'Dr. Robert Martinez', role: 'specialist' },
            { id: 'pharmacist_001', name: 'PharmD Lisa Thompson', role: 'pharmacist' }
        ];

        for (const user of users) {
            await addUser(user.id, user.name);
            console.log(`   👤 Created user: ${user.name} (${user.role})`);
        }

        this.users = users;
        console.log(`✅ Created ${users.length} users for medical simulation`);
    }

    async testTraditionalCareCircle() {
        console.log('\n🔄 TEST 1: Traditional Care Circle (Legacy API)');
        
        // Test existing API (backward compatibility)
        const patientId = 'patient_diabetes_001';
        this.circleId = `care_circle_${randomUUID().substring(0, 8)}`;
        
        await createCareCircle(this.circleId, patientId);
        console.log(`✅ Created care circle: ${this.circleId}`);

        // Add members using legacy API
        const coreMembers = [
            { id: 'patient_diabetes_001', role: 'patient', relationship: 'self' },
            { id: 'caregiver_spouse_001', role: 'caregiver', relationship: 'spouse' },
            { id: 'doctor_primary_001', role: 'doctor', relationship: 'primary_physician' }
        ];

        for (const member of coreMembers) {
            await addMemberToCircle(this.circleId, member.id, member.role, member.relationship);
            console.log(`   ➕ Added ${member.role}: ${this.users.find(u => u.id === member.id)?.name}`);
        }

        // Verify members using legacy API
        const members = await getCircleMembers(this.circleId);
        console.log(`✅ Legacy API: Circle has ${members.length} members`);
        
        return members.length === 3;
    }

    async testNewCareCircleManager() {
        console.log('\n🔄 TEST 2: New CareCircleManager (SocialCircle base)');
        
        const careManager = new CareCircleManager('patient_diabetes_001');
        
        // Create circle using new unified API
        const newCircleId = await careManager.createCircle({
            name: 'Sarah\'s Diabetes Care Team',
            description: 'Comprehensive diabetes management and support',
            primaryUserId: 'patient_diabetes_001'
        });

        console.log(`✅ Created circle with new API: ${newCircleId}`);

        // Add members using new unified API
        await careManager.addMember(newCircleId, 'patient_diabetes_001', 'patient', 'self');
        await careManager.addMember(newCircleId, 'doctor_primary_001', 'doctor', 'primary_physician');
        await careManager.addMember(newCircleId, 'caregiver_spouse_001', 'caregiver', 'spouse');
        await careManager.addMember(newCircleId, 'nurse_diabetes_001', 'nurse', 'care_team');
        await careManager.addMember(newCircleId, 'specialist_endo_001', 'specialist', 'consultant');

        const members = await careManager.getMembers(newCircleId);
        console.log(`✅ New API: Circle has ${members.length} members`);
        members.forEach(m => console.log(`   - ${m.username}: ${m.role} (${m.relationship_type})`));

        // Test medical-specific validation
        const validation = await careManager.validateCirclePattern(newCircleId);
        console.log(`✅ Medical validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
        if (validation.valid) {
            console.log(`   - Patient count: ${validation.patientCount}`);
            console.log(`   - Care providers: ${validation.careProviders}`);
        }

        return validation.valid && members.length === 5;
    }

    async simulateMedicalWorkflow() {
        console.log('\n🔄 TEST 3: Medical Workflow Simulation');
        
        const careManager = new CareCircleManager('patient_diabetes_001');
        const circleId = this.circleId;

        // Simulate medical coordination scenarios
        const scenarios = [
            {
                name: 'Daily Medication Check',
                action: async () => {
                    await careManager.sendMessage(circleId, 
                        'Morning insulin administered: 10 units Humalog at 7:30 AM. Blood glucose: 142 mg/dL', 
                        'medical_standard'
                    );
                    this.simulationData.medicationChecks++;
                    return 'Medication logged successfully';
                }
            },
            {
                name: 'Care Coordination',
                action: async () => {
                    const optimization = await careManager.calculateOptimalOutcome(circleId, 'care_coordination');
                    console.log(`   📋 Care coordination strategy: ${optimization.strategy}`);
                    console.log(`   👨‍⚕️ Primary caregiver: ${optimization.primaryCaregiver ? 'assigned' : 'none'}`);
                    return optimization.strategy;
                }
            },
            {
                name: 'Emergency Escalation',
                action: async () => {
                    const escalation = await careManager.escalateIssue(circleId, {
                        type: 'health_emergency',
                        description: 'Patient reports severe hypoglycemic symptoms',
                        severity: 'high',
                        timestamp: Date.now()
                    }, 'emergency');
                    this.simulationData.emergencyAlerts++;
                    return `Emergency escalated to ${escalation.notifiedProviders || 'all'} providers`;
                }
            }
        ];

        for (const scenario of scenarios) {
            console.log(`\n   🎭 Scenario: ${scenario.name}`);
            try {
                const result = await scenario.action();
                console.log(`   ✅ Result: ${result}`);
            } catch (error) {
                console.log(`   ❌ Error: ${error.message}`);
                return false;
            }
        }

        return true;
    }

    async testDataConsistency() {
        console.log('\n🔄 TEST 4: Data Consistency Check');
        
        // Verify legacy and new APIs see the same data
        const db = await getDb();
        
        // Count circles created
        const circleCount = await db.get('SELECT COUNT(*) as count FROM care_circles WHERE circle_type = "medical" OR circle_type IS NULL');
        console.log(`✅ Total medical circles in database: ${circleCount.count}`);
        
        // Count total members  
        const memberCount = await db.get(`
            SELECT COUNT(*) as count 
            FROM care_circle_members ccm 
            JOIN care_circles cc ON ccm.circle_id = cc.circle_id 
            WHERE cc.circle_type = "medical" OR cc.circle_type IS NULL
        `);
        console.log(`✅ Total care circle members: ${memberCount.count}`);

        // Check schema extensions don't break existing queries
        const legacyQuery = await db.all(`
            SELECT ccm.user_id, ccm.role, u.username
            FROM care_circle_members ccm
            JOIN users u ON ccm.user_id = u.user_id  
            WHERE ccm.circle_id = ?
        `, [this.circleId]);
        
        console.log(`✅ Legacy query compatibility: ${legacyQuery.length} members found`);
        
        return circleCount.count > 0 && memberCount.count > 0;
    }

    async generateReport() {
        console.log('\n📊 CARE CIRCLE SIMULATION REPORT');
        console.log('=================================');
        console.log(`🏥 Circle ID: ${this.circleId}`);
        console.log(`👥 Total Users Created: ${this.users?.length || 0}`);
        console.log(`💊 Medication Checks: ${this.simulationData.medicationChecks}`);
        console.log(`🚨 Emergency Alerts: ${this.simulationData.emergencyAlerts}`);
        console.log(`📱 Messages Sent: ${this.simulationData.messagesCount}`);
        
        // Get final analytics
        const careManager = new CareCircleManager('patient_diabetes_001');
        try {
            const analytics = await careManager.getAnalytics(this.circleId);
            console.log(`📈 Circle Analytics:`);
            console.log(`   - Members: ${analytics.memberCount}`);
            console.log(`   - Messages: ${analytics.messageCount}`);
            console.log(`   - Circle Type: ${analytics.circleType}`);
            console.log(`   - Organization Scope: ${analytics.organizationScope}`);
        } catch (error) {
            console.log(`⚠️  Analytics error: ${error.message}`);
        }
        
        console.log('\n✅ CARE CIRCLE SIMULATION COMPLETED');
        return this.simulationData;
    }

    async run() {
        try {
            await this.initialize();
            await this.setupMedicalScenario();
            
            const test1 = await this.testTraditionalCareCircle();
            const test2 = await this.testNewCareCircleManager();
            const test3 = await this.simulateMedicalWorkflow();
            const test4 = await this.testDataConsistency();
            
            await this.generateReport();
            
            const allTestsPassed = test1 && test2 && test3 && test4;
            console.log(`\n🎯 OVERALL RESULT: ${allTestsPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
            
            return allTestsPassed;
            
        } catch (error) {
            console.error('❌ Simulation failed:', error);
            return false;
        }
    }
}

// Run simulation if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
    const simulation = new CareCircleSimulation();
    simulation.run().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { CareCircleSimulation };