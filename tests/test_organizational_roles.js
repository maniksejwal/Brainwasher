#!/usr/bin/env node

/**
 * Organizational Role System Test
 * Test comprehensive organizational role and hierarchy functionality
 */

import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import chalk from 'chalk';

async function testOrganizationalRoles() {
    console.log(chalk.green('🧪 Testing Organizational Role System'));
    console.log(chalk.gray('Non-interactive comprehensive test\n'));

    const db = await getDb();
    await initializeBusinessSchema(db);

    try {
        // Test 1: Create organizations
        console.log(chalk.blue('📝 Test 1: Create Organizations'));
        
        const medicalOrg = await createOrg(db, 'Smith Medical Practice', 'llc');
        const businessOrg = await createOrg(db, 'Healthcare Ventures Inc', 'corporation');
        
        console.log(chalk.green(`✅ Created medical org: ${medicalOrg}`));
        console.log(chalk.green(`✅ Created business org: ${businessOrg}`));

        // Test 2: Multi-role user (clinician + business owner)
        console.log(chalk.blue('\n👥 Test 2: Multi-Role User'));
        
        const userId = 'dr_smith_test';
        
        // Add as clinician in medical practice
        await addUserToOrg(db, userId, medicalOrg, 'clinician', 'Medical', 'Chief Medical Officer', null, 8);
        
        // Add as CEO in business org
        await addUserToOrg(db, userId, businessOrg, 'ceo', 'Executive', 'CEO & Founder', null, 10);
        
        console.log(chalk.green(`✅ Added ${userId} as multi-role user`));

        // Test 3: Organizational hierarchy
        console.log(chalk.blue('\n🏢 Test 3: Organizational Hierarchy'));
        
        // Add more users to create hierarchy
        await addUserToOrg(db, 'sales_manager', businessOrg, 'sales_manager', 'Sales', 'Sales Manager', userId, 6);
        await addUserToOrg(db, 'sales_rep1', businessOrg, 'sales_rep', 'Sales', 'Sales Rep', 'sales_manager', 3);
        await addUserToOrg(db, 'cfo_user', businessOrg, 'cfo', 'Finance', 'Chief Financial Officer', userId, 9);
        
        console.log(chalk.green('✅ Created organizational hierarchy'));

        // Test 4: View hierarchy
        console.log(chalk.blue('\n📊 Test 4: View Complete Hierarchy'));
        await viewHierarchy(db);

        // Test 5: Test permissions for multi-role user
        console.log(chalk.blue('\n🔐 Test 5: Permission Testing'));
        await testUserPermissions(db, userId);

        // Test 6: Role definitions
        console.log(chalk.blue('\n📋 Test 6: Role Definitions'));
        await viewRoleDefinitions(db);

        console.log(chalk.green('\n🎉 All tests completed successfully!'));
        console.log(chalk.yellow('\n💡 Key Features Demonstrated:'));
        console.log('   - Multi-organizational structure');
        console.log('   - Hierarchical reporting relationships');
        console.log('   - Role-based permissions with approval authorities');
        console.log('   - Multi-role users (clinician + business owner)');
        console.log('   - Context-aware behavior switching capability');

    } catch (error) {
        console.error(chalk.red('❌ Test failed:'), error.message);
    }
}

async function createOrg(db, name, type) {
    const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const settings = JSON.stringify({
        contextSharing: 'filtered',
        defaultApprovalChain: true,
        requireSignOffs: ['legal', 'finance']
    });

    await db.run(
        `INSERT INTO organizations (id, name, type, settings, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, name, type, settings, Date.now()]
    );

    return orgId;
}

async function addUserToOrg(db, userId, orgId, role, department, title, reportsTo, authorityLevel) {
    const hierarchyId = `hier_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    
    await db.run(
        `INSERT INTO org_hierarchies (id, org_id, user_id, role, reports_to, authority_level, department, title, start_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [hierarchyId, orgId, userId, role, reportsTo, authorityLevel, department, title, Date.now(), Date.now()]
    );
}

async function viewHierarchy(db) {
    const hierarchy = await db.all(`
        SELECT o.name as org_name, o.type, h.user_id, h.role, h.title, h.department, 
               h.reports_to, h.authority_level, rd.description, rd.approval_authority
        FROM org_hierarchies h
        JOIN organizations o ON h.org_id = o.id
        LEFT JOIN role_definitions rd ON h.role = rd.id
        WHERE h.end_date IS NULL
        ORDER BY o.name, h.authority_level DESC
    `);

    let currentOrg = '';
    hierarchy.forEach(person => {
        if (person.org_name !== currentOrg) {
            currentOrg = person.org_name;
            console.log(chalk.cyan(`\n  🏢 ${currentOrg} (${person.type})`));
        }
        
        const reportingLine = person.reports_to ? chalk.gray(` → Reports to: ${person.reports_to}`) : chalk.gray(' → Top Level');
        console.log(`    👤 ${chalk.white(person.user_id)} - ${chalk.yellow(person.title)}`);
        console.log(`       ${chalk.gray(person.department)} | Authority: ${person.authority_level} | Approval: $${person.approval_authority || 0}${reportingLine}`);
    });
}

async function testUserPermissions(db, userId) {
    const userRoles = await db.all(`
        SELECT h.role, h.authority_level, h.department, o.name as org_name, o.type,
               rd.permissions, rd.approval_authority
        FROM org_hierarchies h
        JOIN organizations o ON h.org_id = o.id
        LEFT JOIN role_definitions rd ON h.role = rd.id
        WHERE h.user_id = ? AND h.end_date IS NULL
    `, [userId]);

    console.log(chalk.yellow(`\n  📋 Permissions for ${userId}:`));
    
    userRoles.forEach(role => {
        console.log(`\n    🏢 ${chalk.cyan(role.org_name)} (${role.type}) - ${chalk.yellow(role.role)}`);
        console.log(`       Department: ${role.department} | Authority: ${role.authority_level}`);
        console.log(`       Approval Limit: $${role.approval_authority || 0}`);
        
        if (role.permissions) {
            const permissions = JSON.parse(role.permissions);
            console.log(`       Permissions: ${chalk.green(permissions.join(', '))}`);
        }
    });

    // Test specific scenarios
    console.log(chalk.yellow('\n  🧪 Permission Scenarios:'));
    
    const scenarios = [
        { action: 'approve_contract', amount: 50000 },
        { action: 'negotiate_deal', amount: 200000 },
        { action: 'manage_medical', amount: 0 }
    ];

    scenarios.forEach(scenario => {
        const hasPermission = checkPermission(userRoles, scenario.action, scenario.amount);
        const status = hasPermission ? chalk.green('✅ ALLOWED') : chalk.red('❌ DENIED');
        console.log(`    ${scenario.action} ($${scenario.amount}): ${status}`);
    });
}

function checkPermission(userRoles, action, amount) {
    for (const role of userRoles) {
        if (!role.permissions) continue;
        
        const permissions = JSON.parse(role.permissions);
        const hasActionPermission = permissions.includes('all') || 
            permissions.some(p => action.includes(p));
        
        const hasAmountPermission = amount <= (role.approval_authority || 0);
        
        if (hasActionPermission && hasAmountPermission) {
            return true;
        }
    }
    return false;
}

async function viewRoleDefinitions(db) {
    const roles = await db.all('SELECT * FROM role_definitions ORDER BY approval_authority DESC LIMIT 5');
    
    console.log(chalk.yellow('\n  📋 Sample Role Definitions:'));
    
    roles.forEach(role => {
        console.log(`\n    🎭 ${chalk.yellow(role.role_name)}: ${role.description}`);
        console.log(`       Approval Authority: $${role.approval_authority}`);
        
        if (role.permissions) {
            const permissions = JSON.parse(role.permissions);
            console.log(`       Permissions: ${chalk.green(permissions.join(', '))}`);
        }
    });
}

// Run the test
testOrganizationalRoles().catch(console.error);