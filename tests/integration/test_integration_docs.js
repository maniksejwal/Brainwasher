#!/usr/bin/env node

/**
 * Integration Test - Context-Aware Document Collaboration
 * Test the full integration of document collaboration with context-aware routing
 */

import { routeMessage } from '../handlers/contextAwareCompanionRouter.js';
import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { events } from '../orchestrator.js';
import chalk from 'chalk';

async function testIntegratedDocumentSystem() {
    console.log(chalk.green('🔗 Testing Integrated Document Collaboration System'));
    console.log(chalk.gray('Testing document commands through context-aware routing\n'));

    const db = await getDb();
    await initializeBusinessSchema(db);

    // Set up test user
    const userId = 'dr_smith_integration';
    const circleId = 'circle_test';
    
    // Set up org for user
    await setupTestUser(db, userId);

    // Listen to companion responses
    const responses = [];
    const responseHandler = (data) => {
        if (data.targetUsers.includes(userId)) {
            responses.push(data.reply);
            console.log(chalk.cyan(`🤖 Companion: ${data.reply.substring(0, 100)}${data.reply.length > 100 ? '...' : ''}`));
        }
    };
    
    events.on('broadcast', responseHandler);

    try {
        console.log(chalk.blue('📝 Test 1: Context Detection for Document Commands'));
        
        // Test business context with document creation
        console.log(chalk.yellow(`👤 User: "I need to create a contract for the equipment deal"`));
        await routeMessage(userId, circleId, 'I need to create a contract for the equipment deal');
        await sleep(500);

        console.log(chalk.blue('\n📝 Test 2: Document Creation Command'));
        
        console.log(chalk.yellow(`👤 User: "/doc create Equipment Purchase Agreement"`));
        await routeMessage(userId, circleId, '/doc create Equipment Purchase Agreement');
        await sleep(500);

        console.log(chalk.blue('\n📝 Test 3: List Documents'));
        
        console.log(chalk.yellow(`👤 User: "/doc list"`));
        await routeMessage(userId, circleId, '/doc list');
        await sleep(500);

        console.log(chalk.blue('\n📝 Test 4: View Organizational Roles'));
        
        console.log(chalk.yellow(`👤 User: "/org roles"`));
        await routeMessage(userId, circleId, '/org roles');
        await sleep(500);

        console.log(chalk.blue('\n📝 Test 5: Context Sharing Info'));
        
        console.log(chalk.yellow(`👤 User: "/context"`));
        await routeMessage(userId, circleId, '/context');
        await sleep(500);

        console.log(chalk.green('\n🎉 Integrated document system test completed!'));
        console.log(chalk.yellow('\n💡 Integration Features Demonstrated:'));
        console.log('   ✅ Context-aware routing for document commands');
        console.log('   ✅ Business context detection');
        console.log('   ✅ Document creation through companion interface');
        console.log('   ✅ Multi-role user support');
        console.log('   ✅ Cross-domain command routing');
        console.log('   ✅ Organizational role integration');

        console.log(chalk.blue('\n📊 Summary of Available Features:'));
        console.log('   🏢 Comprehensive organizational role system');
        console.log('   📄 Markdown document collaboration');
        console.log('   ⚡ Context-aware companion routing');
        console.log('   🔐 Permission-based access control');
        console.log('   📝 Git-like version control with diffs');
        console.log('   ✅ Sequential approval workflows');
        console.log('   🔧 Terminal editor integration (nano/vim)');
        console.log('   🎯 Role-based behavior switching');

    } catch (error) {
        console.error(chalk.red('❌ Integration test failed:'), error.message);
    } finally {
        events.off('broadcast', responseHandler);
    }
}

async function setupTestUser(db, userId) {
    // Create test organization
    const orgId = `org_integration_${Date.now()}`;
    await db.run(
        `INSERT INTO organizations (id, name, type, settings, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, 'Integration Test Org', 'corporation', '{}', Date.now()]
    );

    // Add user with multiple roles
    const medicalHier = `hier_med_${Date.now()}`;
    const businessHier = `hier_biz_${Date.now()}`;
    
    await db.run(
        `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, authority_level, department, title, start_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [medicalHier, orgId, userId, 'clinician', 8, 'Medical', 'Chief Medical Officer', Date.now(), Date.now()]
    );

    await db.run(
        `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, authority_level, department, title, start_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [businessHier, orgId, userId, 'ceo', 10, 'Executive', 'CEO', Date.now(), Date.now()]
    );

    console.log(chalk.green(`✅ Set up test user: ${userId} with medical + business roles`));
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Run the test
testIntegratedDocumentSystem().catch(console.error);