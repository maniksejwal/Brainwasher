/**
 * Test the simplified professional circle approach
 * Focus on pattern enforcement, not business-specific archetypes
 */

import { getDb } from '../db/connection.js';
import { initializeDatabase } from '../db/schema.js';
import { randomUUID } from 'crypto';

// Import both approaches for comparison
import { ProfessionalCircleManager } from '../agents/business/professionalCircleManager.js';

async function setupTestUsers() {
    const db = await getDb();
    
    const users = [
        { id: 'user_001', username: 'alice_ceo', org: 'startup_inc' },
        { id: 'user_002', username: 'bob_cto', org: 'startup_inc' },
        { id: 'user_003', username: 'carol_designer', org: 'design_agency' },
        
        { id: 'user_004', username: 'dave_buyer', org: 'enterprise_corp' },
        { id: 'user_005', username: 'eve_advocate', org: 'enterprise_corp' },
        { id: 'user_006', username: 'frank_consultant', org: 'consulting_firm' }
    ];

    for (const user of users) {
        await db.run(`
            INSERT OR REPLACE INTO users (user_id, username, created_at, profile_data) 
            VALUES (?, ?, ?, ?)
        `, [user.id, user.username, Date.now(), JSON.stringify({ organization: user.org })]);
    }

    return users;
}

class SimplifiedCircleManager {
    constructor(userId) {
        this.userId = userId;
    }

    /**
     * Create a professional circle with user-defined roles
     */
    async createProfessionalCircle(circleConfig) {
        const db = await getDb();
        const circleId = `circle_${randomUUID().substring(0, 8)}`;
        
        // Create the circle
        await db.run(`
            INSERT INTO care_circles (
                circle_id, 
                primary_patient_id,
                created_at,
                circle_type,
                organization_context,
                coordination_engine
            ) VALUES (?, ?, ?, ?, ?, ?)
        `, [
            circleId,
            circleConfig.members.target.userId,
            Date.now(),
            'professional',
            JSON.stringify({
                scope: circleConfig.organizationContext,
                name: circleConfig.name,
                description: circleConfig.description
            }),
            circleConfig.organizationContext === 'within_org' ? 'internal_optimization' : 'negotiated_optimization'
        ]);

        // Add members with user-defined roles
        await this.addMember(circleId, circleConfig.members.target.userId, circleConfig.members.target.role, 'target');
        await this.addMember(circleId, circleConfig.members.support.userId, circleConfig.members.support.role, 'support');
        await this.addMember(circleId, circleConfig.members.expert.userId, circleConfig.members.expert.role, 'expert');

        return circleId;
    }

    async addMember(circleId, userId, role, relationshipType) {
        const db = await getDb();
        await db.run(`
            INSERT INTO care_circle_members (circle_id, user_id, role, relationship_type, consent_level)
            VALUES (?, ?, ?, ?, ?)
        `, [circleId, userId, role, relationshipType, 'business_standard']);
    }

    async getCircleMembers(circleId) {
        const db = await getDb();
        return await db.all(`
            SELECT m.user_id, m.role, m.relationship_type, u.username
            FROM care_circle_members m
            JOIN users u ON m.user_id = u.user_id
            WHERE m.circle_id = ?
            ORDER BY CASE m.relationship_type 
                WHEN 'target' THEN 1 
                WHEN 'support' THEN 2 
                WHEN 'expert' THEN 3 
                ELSE 4 
            END
        `, [circleId]);
    }
}

async function testSimplifiedApproach() {
    console.log('🎯 Testing Simplified Professional Circle Approach...\n');

    await initializeDatabase();
    const users = await setupTestUsers();
    
    const circleManager = new SimplifiedCircleManager('user_001');

    // TEST 1: Custom Product Launch Circle
    console.log('🚀 TEST 1: Custom Product Launch Circle');
    const launchCircleId = await circleManager.createProfessionalCircle({
        name: "Product Launch Alpha",
        organizationContext: 'within_org',
        members: {
            target: { userId: 'user_001', role: 'Product Owner' },      // User-defined role
            support: { userId: 'user_002', role: 'Launch Coordinator' }, // User-defined role
            expert: { userId: 'user_003', role: 'Brand Strategist' }     // User-defined role
        },
        description: 'Launch new mobile app with 3-person focused team'
    });

    const launchMembers = await circleManager.getCircleMembers(launchCircleId);
    console.log(`✅ Created circle: ${launchCircleId}`);
    console.log('   Members (Target + Support + Expert):');
    launchMembers.forEach(member => {
        console.log(`   - ${member.username}: "${member.role}" (${member.relationship_type})`);
    });

    // TEST 2: Cross-Org Partnership Circle  
    console.log('\n🤝 TEST 2: Cross-Org Partnership Circle');
    const partnershipCircleId = await circleManager.createProfessionalCircle({
        name: "Enterprise Integration",
        organizationContext: 'across_org',
        members: {
            target: { userId: 'user_004', role: 'Integration Lead' },     // Custom role
            support: { userId: 'user_005', role: 'Business Liaison' },    // Custom role  
            expert: { userId: 'user_006', role: 'Solutions Architect' }   // Custom role
        },
        description: 'Cross-org integration project with flexible roles'
    });

    const partnershipMembers = await circleManager.getCircleMembers(partnershipCircleId);
    console.log(`✅ Created circle: ${partnershipCircleId}`);
    console.log('   Members (Target + Support + Expert):');
    partnershipMembers.forEach(member => {
        console.log(`   - ${member.username}: "${member.role}" (${member.relationship_type})`);
    });

    // TEST 3: Compare with Predefined Approach
    console.log('\n⚖️  TEST 3: Compare Approaches');
    const predefinedManager = new ProfessionalCircleManager('user_001');
    const predefinedCircleId = await predefinedManager.createProfessionalCircle({
        type: 'deal', // Predefined archetype
        organizationContext: 'across_org',
        members: {
            target: 'user_004',  
            support: 'user_005',
            expert: 'user_006'
        },
        description: 'Using predefined deal archetype'
    });

    const predefinedMembers = await predefinedManager.getCircleMembers(predefinedCircleId);
    console.log(`✅ Predefined approach: ${predefinedCircleId}`);
    console.log('   Members (Fixed Archetype):');
    predefinedMembers.forEach(member => {
        console.log(`   - ${member.username}: "${member.role}" (${member.relationship_type})`);
    });

    return {
        simplified: { launchCircleId, partnershipCircleId },
        predefined: { predefinedCircleId },
        analysis: {
            flexibility: "Simplified allows custom role names",
            complexity: "Predefined adds business logic overhead", 
            pattern: "Both enforce Target + Support + Expert structure"
        }
    };
}

async function compareApproaches() {
    console.log('\n📊 APPROACH COMPARISON\n');

    const results = await testSimplifiedApproach();

    console.log('🏗️  SIMPLIFIED APPROACH:');
    console.log('   ✅ User-defined role names');
    console.log('   ✅ Less code complexity');
    console.log('   ✅ More flexible for diverse use cases');
    console.log('   ✅ Still enforces 3-person pattern');
    console.log('   ❌ No business-specific templates');

    console.log('\n🎯 PREDEFINED ARCHETYPE APPROACH:');
    console.log('   ✅ Business-specific role suggestions');
    console.log('   ✅ Template-driven UX');
    console.log('   ❌ More code complexity');
    console.log('   ❌ Less flexible for edge cases');
    console.log('   ❌ Requires maintaining business logic');

    console.log('\n💡 RECOMMENDATION:');
    console.log('   → Use SIMPLIFIED approach as core');
    console.log('   → Add OPTIONAL templates as UI helpers');
    console.log('   → Keep the Target + Support + Expert pattern');
    console.log('   → Let users define their own role labels');

    return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
    compareApproaches().catch(console.error);
}

export { compareApproaches, testSimplifiedApproach };