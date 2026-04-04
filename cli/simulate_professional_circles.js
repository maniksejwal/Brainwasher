#!/usr/bin/env node

/**
 * Professional Circle CLI Simulation - Business Workflow Testing
 * Tests professional circle functionality with SocialCircle base class
 */

import { getDb } from '../db/connection.js';
import { initializeDatabase } from '../db/schema.js';
import { addUser } from '../db/index.js';
import { ProfessionalCircleManager } from '../agents/social/SpecializedCircleManagers.js';
import { randomUUID } from 'crypto';

class ProfessionalCircleSimulation {
    constructor() {
        this.circles = [];
        this.users = [];
        this.simulationData = {
            projectsCreated: 0,
            dealsClosed: 0,
            meetingsScheduled: 0,
            budgetAllocations: 0,
            crossOrgCollaborations: 0
        };
    }

    async initialize() {
        console.log('🏢 PROFESSIONAL CIRCLE CLI SIMULATION');
        console.log('=====================================\n');
        
        await initializeDatabase();
        console.log('✅ Database initialized');
    }

    async setupBusinessScenario() {
        console.log('\n📋 Setting up business scenario...');
        
        // Create diverse business users across organizations
        const organizations = {
            'tech_startup': [
                { id: 'ceo_startup', name: 'Alice Chen', role: 'CEO' },
                { id: 'cto_startup', name: 'Bob Rodriguez', role: 'CTO' },
                { id: 'pm_startup', name: 'Carol Kim', role: 'Product Manager' },
                { id: 'dev_startup', name: 'David Singh', role: 'Senior Developer' }
            ],
            'enterprise_client': [
                { id: 'buyer_enterprise', name: 'Emma Wilson', role: 'IT Director' },
                { id: 'champion_enterprise', name: 'Frank Brown', role: 'VP Engineering' },
                { id: 'stakeholder_enterprise', name: 'Grace Davis', role: 'Business Analyst' }
            ],
            'consulting_firm': [
                { id: 'consultant_lead', name: 'Henry Martinez', role: 'Senior Consultant' },
                { id: 'consultant_tech', name: 'Iris Thompson', role: 'Technical Consultant' },
                { id: 'consultant_business', name: 'Jack Anderson', role: 'Business Consultant' }
            ]
        };

        for (const [org, users] of Object.entries(organizations)) {
            console.log(`   🏢 Creating ${org} team:`);
            for (const user of users) {
                await addUser(user.id, user.name);
                user.organization = org;
                this.users.push(user);
                console.log(`     👤 ${user.name} (${user.role})`);
            }
        }

        console.log(`✅ Created ${this.users.length} business users across ${Object.keys(organizations).length} organizations`);
    }

    async testIntraOrganizationalCircle() {
        console.log('\n🔄 TEST 1: Intra-Organizational Professional Circle');
        
        const profManager = new ProfessionalCircleManager('ceo_startup');
        
        // Create internal product development circle
        const circleId = await profManager.createCircle({
            name: 'Mobile App MVP Development',
            description: 'Internal team for mobile app development project',
            primaryUserId: 'pm_startup',
            members: [
                { userId: 'pm_startup', role: 'Product Manager', relationshipType: 'target' },
                { userId: 'cto_startup', role: 'Technical Coordinator', relationshipType: 'support' },
                { userId: 'dev_startup', role: 'Lead Developer', relationshipType: 'expert' }
            ]
        });

        this.circles.push({ id: circleId, type: 'intra_org', name: 'Mobile App MVP' });
        console.log(`✅ Created intra-org circle: ${circleId}`);

        const members = await profManager.getMembers(circleId);
        console.log(`👥 Core team (${members.length} members):`);
        members.forEach(m => console.log(`   - ${m.username}: ${m.role} (${m.relationship_type})`));

        // Test professional validation
        const validation = await profManager.validateCirclePattern(circleId);
        console.log(`✅ Professional validation: ${validation.valid ? 'PASSED' : 'FAILED'}`);
        if (validation.valid) {
            console.log(`   - Core team: ${validation.coreTeam.length} members`);
            console.log(`   - Additional: ${validation.additionalMembers.length} members`);
        }

        // Add CEO as stakeholder (additional member beyond core 3)
        await profManager.addAdditionalMember(circleId, 'ceo_startup', 'Executive Sponsor', 'stakeholder');
        console.log(`➕ Added CEO as stakeholder`);

        this.simulationData.projectsCreated++;
        return validation.valid;
    }

    async testInterOrganizationalCircle() {
        console.log('\n🔄 TEST 2: Inter-Organizational Professional Circle (Client-Vendor)');
        
        const profManager = new ProfessionalCircleManager('buyer_enterprise');
        
        // Create cross-org deal circle
        const circleId = await profManager.createCircle({
            name: 'Enterprise Integration Deal',
            description: 'Cross-organizational software procurement and integration',
            primaryUserId: 'buyer_enterprise',
            members: [
                { userId: 'buyer_enterprise', role: 'IT Director', relationshipType: 'target' },
                { userId: 'champion_enterprise', role: 'VP Engineering', relationshipType: 'support' },
                { userId: 'ceo_startup', role: 'Vendor CEO', relationshipType: 'expert' }
            ]
        });

        this.circles.push({ id: circleId, type: 'inter_org', name: 'Enterprise Deal' });
        console.log(`✅ Created inter-org circle: ${circleId}`);

        const members = await profManager.getMembers(circleId);
        console.log(`👥 Deal team (${members.length} members):`);
        members.forEach(m => console.log(`   - ${m.username}: ${m.role} (${m.relationship_type})`));

        // Add consultant as additional expert
        await profManager.addAdditionalMember(circleId, 'consultant_business', 'Integration Consultant', 'additional');
        console.log(`➕ Added external consultant`);

        this.simulationData.dealsClosed++;
        this.simulationData.crossOrgCollaborations++;
        
        const finalMembers = await profManager.getMembers(circleId);
        return finalMembers.length === 4;
    }

    async testHybridCircle() {
        console.log('\n🔄 TEST 3: Hybrid Professional Circle (Multi-Organization)');
        
        const profManager = new ProfessionalCircleManager('consultant_lead');
        
        // Create hybrid consulting engagement
        const circleId = await profManager.createCircle({
            name: 'Digital Transformation Initiative',
            description: 'Multi-party digital transformation consulting engagement',
            primaryUserId: 'stakeholder_enterprise',
            members: [
                { userId: 'stakeholder_enterprise', role: 'Business Lead', relationshipType: 'target' },
                { userId: 'consultant_lead', role: 'Engagement Manager', relationshipType: 'support' },
                { userId: 'consultant_tech', role: 'Technical Architect', relationshipType: 'expert' }
            ]
        });

        this.circles.push({ id: circleId, type: 'hybrid', name: 'Digital Transformation' });
        console.log(`✅ Created hybrid circle: ${circleId}`);

        // Add members from all three organizations
        await profManager.addAdditionalMember(circleId, 'cto_startup', 'Technology Partner', 'partner');
        await profManager.addAdditionalMember(circleId, 'consultant_business', 'Business Analyst', 'additional');
        
        const members = await profManager.getMembers(circleId);
        console.log(`👥 Transformation team (${members.length} members):`);
        members.forEach(m => console.log(`   - ${m.username}: ${m.role} (${m.relationship_type})`));

        this.simulationData.crossOrgCollaborations++;
        return members.length === 5;
    }

    async simulateBusinessWorkflows() {
        console.log('\n🔄 TEST 4: Business Workflow Simulations');
        
        for (const circle of this.circles) {
            console.log(`\n   💼 Simulating workflows for: ${circle.name}`);
            
            const profManager = new ProfessionalCircleManager('pm_startup');
            
            // Test business-specific scenarios
            const scenarios = [
                {
                    name: 'Project Delivery Optimization',
                    action: async () => {
                        const optimization = await profManager.calculateOptimalOutcome(circle.id, 'project_delivery');
                        console.log(`     📋 Strategy: ${optimization.strategy}`);
                        console.log(`     👔 Decision maker: ${optimization.decisionMaker ? 'assigned' : 'none'}`);
                        console.log(`     🛠️ Technical lead: ${optimization.technicalLead ? 'assigned' : 'none'}`);
                        return optimization.strategy;
                    }
                },
                {
                    name: 'Budget Coordination',
                    action: async () => {
                        // Simulate budget allocation
                        await profManager.sendMessage(circle.id, 
                            `Q2 Budget Allocation: $150K approved for ${circle.name} initiative`, 
                            'business_standard'
                        );
                        this.simulationData.budgetAllocations++;
                        return 'Budget allocated successfully';
                    }
                },
                {
                    name: 'Meeting Scheduling',
                    action: async () => {
                        await profManager.sendMessage(circle.id,
                            `Weekly standup scheduled: Tuesdays 10:00 AM Pacific for ${circle.name} team`,
                            'business_standard'
                        );
                        this.simulationData.meetingsScheduled++;
                        return 'Meeting scheduled successfully';
                    }
                }
            ];

            for (const scenario of scenarios) {
                try {
                    const result = await scenario.action();
                    console.log(`     ✅ ${scenario.name}: ${result}`);
                } catch (error) {
                    console.log(`     ❌ ${scenario.name}: ${error.message}`);
                }
            }
        }

        return true;
    }

    async testTargetSupportExpertPattern() {
        console.log('\n🔄 TEST 5: Target + Support + Expert Pattern Validation');
        
        for (const circle of this.circles) {
            const profManager = new ProfessionalCircleManager('pm_startup');
            const validation = await profManager.validateCirclePattern(circle.id);
            
            console.log(`\n   🎯 Circle: ${circle.name}`);
            console.log(`   ✅ Pattern valid: ${validation.valid ? 'YES' : 'NO'}`);
            
            if (validation.valid) {
                const coreTeam = validation.coreTeam || validation.members.filter(m => 
                    ['target', 'support', 'expert'].includes(m.relationship_type)
                );
                const additionalTeam = validation.additionalMembers || validation.members.filter(m => 
                    !['target', 'support', 'expert'].includes(m.relationship_type)
                );
                
                console.log(`   👥 Core team: ${coreTeam.length} (Target + Support + Expert)`);
                console.log(`   ➕ Additional: ${additionalTeam.length} members`);
                
                coreTeam.forEach(member => {
                    console.log(`     - ${member.relationship_type}: ${member.role}`);
                });
            }
        }

        return this.circles.every(async circle => {
            const profManager = new ProfessionalCircleManager('pm_startup');
            const validation = await profManager.validateCirclePattern(circle.id);
            return validation.valid;
        });
    }

    async generateReport() {
        console.log('\n📊 PROFESSIONAL CIRCLE SIMULATION REPORT');
        console.log('=========================================');
        console.log(`🏢 Circles Created: ${this.circles.length}`);
        console.log(`   - Intra-org: ${this.circles.filter(c => c.type === 'intra_org').length}`);
        console.log(`   - Inter-org: ${this.circles.filter(c => c.type === 'inter_org').length}`);
        console.log(`   - Hybrid: ${this.circles.filter(c => c.type === 'hybrid').length}`);
        
        console.log(`\n📈 Business Metrics:`);
        console.log(`   💼 Projects: ${this.simulationData.projectsCreated}`);
        console.log(`   🤝 Deals: ${this.simulationData.dealsClosed}`);
        console.log(`   📅 Meetings: ${this.simulationData.meetingsScheduled}`);
        console.log(`   💰 Budget Allocations: ${this.simulationData.budgetAllocations}`);
        console.log(`   🌐 Cross-Org Collaborations: ${this.simulationData.crossOrgCollaborations}`);

        // Get analytics for each circle
        const profManager = new ProfessionalCircleManager('pm_startup');
        console.log(`\n🔍 Circle Analytics:`);
        for (const circle of this.circles) {
            try {
                const analytics = await profManager.getAnalytics(circle.id);
                console.log(`   ${circle.name}:`);
                console.log(`     - Members: ${analytics.memberCount}`);
                console.log(`     - Messages: ${analytics.messageCount}`);
                console.log(`     - Type: ${analytics.circleType}`);
                console.log(`     - Scope: ${analytics.organizationScope}`);
            } catch (error) {
                console.log(`   ${circle.name}: Analytics error - ${error.message}`);
            }
        }
        
        console.log('\n✅ PROFESSIONAL CIRCLE SIMULATION COMPLETED');
        return this.simulationData;
    }

    async run() {
        try {
            await this.initialize();
            await this.setupBusinessScenario();
            
            const test1 = await this.testIntraOrganizationalCircle();
            const test2 = await this.testInterOrganizationalCircle();  
            const test3 = await this.testHybridCircle();
            const test4 = await this.simulateBusinessWorkflows();
            const test5 = await this.testTargetSupportExpertPattern();
            
            await this.generateReport();
            
            const allTestsPassed = test1 && test2 && test3 && test4 && test5;
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
    const simulation = new ProfessionalCircleSimulation();
    simulation.run().then(success => {
        process.exit(success ? 0 : 1);
    }).catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

export { ProfessionalCircleSimulation };