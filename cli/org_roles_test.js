#!/usr/bin/env node

/**
 * Organizational Role Management CLI
 * Test comprehensive organizational role and hierarchy system
 */

import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { readlineManager } from './readline_manager.js';
import chalk from 'chalk';

class OrgRoleCLI {
    constructor() {
        this.db = null;
        this.currentUser = null;
    }

    async initialize() {
        this.db = await getDb();
        await initializeBusinessSchema(this.db);
        console.log(chalk.green('🏢 Organizational Role System CLI'));
        console.log(chalk.gray('Testing comprehensive role and hierarchy management\n'));
    }

    async run() {
        await this.initialize();
        
        while (true) {
            try {
                const choice = await this.mainMenu();
                if (choice === 'exit') break;
                await this.handleChoice(choice);
            } catch (error) {
                console.error(chalk.red('Error:'), error.message);
            }
        }
    }

    async mainMenu() {
        console.log(chalk.cyan('\n--- Organizational Role Management ---'));
        console.log('1. Create Organization');
        console.log('2. Add User to Organization'); 
        console.log('3. View Organizational Hierarchy');
        console.log('4. Test Role-Based Permissions');
        console.log('5. Create Project with Roles');
        console.log('6. View Role Definitions');
        console.log('7. Simulate Multi-Role User (e.g., Clinician + Business Owner)');
        console.log('0. Exit');

        const choice = await readlineManager.question(chalk.yellow('Choose option: '));
        return choice.trim();
    }

    async handleChoice(choice) {
        switch (choice) {
            case '1': await this.createOrganization(); break;
            case '2': await this.addUserToOrg(); break;
            case '3': await this.viewHierarchy(); break;
            case '4': await this.testPermissions(); break;
            case '5': await this.createProject(); break;
            case '6': await this.viewRoleDefinitions(); break;
            case '7': await this.simulateMultiRoleUser(); break;
            case '0': return 'exit';
            default: console.log(chalk.red('Invalid choice'));
        }
    }

    async createOrganization() {
        console.log(chalk.blue('\n--- Create Organization ---'));
        
        const name = await readlineManager.question('Organization name: ');
        const type = await readlineManager.question('Type (corporation/llc/partnership): ');
        
        const orgId = `org_${Date.now()}`;
        const settings = JSON.stringify({
            contextSharing: 'filtered',
            defaultApprovalChain: true,
            requireSignOffs: ['legal', 'finance']
        });

        await this.db.run(
            `INSERT INTO organizations (id, name, type, settings, created_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [orgId, name, type, settings, Date.now()]
        );

        console.log(chalk.green(`✅ Organization "${name}" created with ID: ${orgId}`));
        return orgId;
    }

    async addUserToOrg() {
        console.log(chalk.blue('\n--- Add User to Organization ---'));
        
        const orgs = await this.db.all('SELECT * FROM organizations');
        if (orgs.length === 0) {
            console.log(chalk.yellow('No organizations found. Create one first.'));
            return;
        }

        console.log(chalk.gray('Available organizations:'));
        orgs.forEach((org, i) => console.log(`${i + 1}. ${org.name} (${org.id})`));
        
        const orgChoice = await readlineManager.question('Select organization (number): ');
        const selectedOrg = orgs[parseInt(orgChoice) - 1];
        
        if (!selectedOrg) {
            console.log(chalk.red('Invalid organization selection'));
            return;
        }

        const userId = await readlineManager.question('User ID: ');
        const role = await readlineManager.question('Role (ceo/cfo/sales_manager/etc): ');
        const department = await readlineManager.question('Department: ');
        const title = await readlineManager.question('Job Title: ');
        const reportsTo = await readlineManager.question('Reports to (User ID, or leave empty): ');

        const hierarchyId = `hier_${Date.now()}`;
        
        await this.db.run(
            `INSERT INTO org_hierarchies (id, org_id, user_id, role, reports_to, authority_level, department, title, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [hierarchyId, selectedOrg.id, userId, role, reportsTo || null, 5, department, title, Date.now(), Date.now()]
        );

        console.log(chalk.green(`✅ User ${userId} added to ${selectedOrg.name} as ${role}`));
    }

    async viewHierarchy() {
        console.log(chalk.blue('\n--- Organizational Hierarchy ---'));
        
        const hierarchy = await this.db.all(`
            SELECT o.name as org_name, h.user_id, h.role, h.title, h.department, 
                   h.reports_to, h.authority_level, rd.description
            FROM org_hierarchies h
            JOIN organizations o ON h.org_id = o.id
            LEFT JOIN role_definitions rd ON h.role = rd.id
            WHERE h.end_date IS NULL
            ORDER BY o.name, h.authority_level DESC
        `);

        if (hierarchy.length === 0) {
            console.log(chalk.yellow('No organizational hierarchy found'));
            return;
        }

        let currentOrg = '';
        hierarchy.forEach(person => {
            if (person.org_name !== currentOrg) {
                currentOrg = person.org_name;
                console.log(chalk.cyan(`\n🏢 ${currentOrg}`));
            }
            
            const reportingLine = person.reports_to ? chalk.gray(` → Reports to: ${person.reports_to}`) : '';
            console.log(`  👤 ${chalk.white(person.user_id)} - ${chalk.yellow(person.title || person.role)}`);
            console.log(`     ${chalk.gray(person.department)} | Authority Level: ${person.authority_level}${reportingLine}`);
            if (person.description) {
                console.log(`     ${chalk.dim(person.description)}`);
            }
        });
    }

    async testPermissions() {
        console.log(chalk.blue('\n--- Test Role-Based Permissions ---'));
        
        const userId = await readlineManager.question('Enter User ID to test: ');
        
        // Get user's roles across all organizations
        const userRoles = await this.db.all(`
            SELECT h.role, h.authority_level, h.department, o.name as org_name,
                   rd.permissions, rd.approval_authority
            FROM org_hierarchies h
            JOIN organizations o ON h.org_id = o.id
            LEFT JOIN role_definitions rd ON h.role = rd.id
            WHERE h.user_id = ? AND h.end_date IS NULL
        `, [userId]);

        if (userRoles.length === 0) {
            console.log(chalk.yellow(`No roles found for user ${userId}`));
            return;
        }

        console.log(chalk.green(`\n📋 Permissions for ${userId}:`));
        
        userRoles.forEach(role => {
            console.log(`\n🏢 ${chalk.cyan(role.org_name)} - ${chalk.yellow(role.role)}`);
            console.log(`   Department: ${role.department}`);
            console.log(`   Authority Level: ${role.authority_level}`);
            console.log(`   Approval Limit: $${role.approval_authority || 0}`);
            
            if (role.permissions) {
                const permissions = JSON.parse(role.permissions);
                console.log(`   Permissions: ${chalk.green(permissions.join(', '))}`);
            }
        });

        // Test a specific action
        const action = await readlineManager.question('\nTest action (approve_contract/negotiate_deal/manage_crm): ');
        const amount = parseFloat(await readlineManager.question('Amount involved ($): ')) || 0;
        
        const hasPermission = this.checkPermission(userRoles, action, amount);
        console.log(hasPermission ? 
            chalk.green(`✅ ${userId} can perform "${action}" for $${amount}`) :
            chalk.red(`❌ ${userId} cannot perform "${action}" for $${amount}`)
        );
    }

    checkPermission(userRoles, action, amount) {
        // Check if user has permission for this action and amount
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

    async createProject() {
        console.log(chalk.blue('\n--- Create Project with Roles ---'));
        
        const projectId = `proj_${Date.now()}`;
        const projectName = await readlineManager.question('Project name: ');
        
        console.log(chalk.green(`Created project: ${projectName} (${projectId})`));
        console.log(chalk.gray('Adding team members...'));
        
        while (true) {
            const userId = await readlineManager.question('User ID (or "done" to finish): ');
            if (userId === 'done') break;
            
            const role = await readlineManager.question('Project role: ');
            const temporary = await readlineManager.question('Temporary role? (y/n): ');
            
            await this.db.run(
                `INSERT INTO project_roles (id, project_id, user_id, role, temporary, start_date, authority_level, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [`proj_role_${Date.now()}`, projectId, userId, role, temporary === 'y', Date.now(), 3, Date.now()]
            );
            
            console.log(chalk.green(`✅ Added ${userId} as ${role} to project`));
        }
    }

    async viewRoleDefinitions() {
        console.log(chalk.blue('\n--- Role Definitions ---'));
        
        const roles = await this.db.all('SELECT * FROM role_definitions ORDER BY approval_authority DESC');
        
        roles.forEach(role => {
            console.log(`\n🎭 ${chalk.yellow(role.role_name)}`);
            console.log(`   Description: ${role.description}`);
            console.log(`   Approval Authority: $${role.approval_authority}`);
            
            if (role.permissions) {
                const permissions = JSON.parse(role.permissions);
                console.log(`   Permissions: ${chalk.green(permissions.join(', '))}`);
            }
            
            if (role.delegation_rights) {
                const delegations = JSON.parse(role.delegation_rights);
                console.log(`   Can Delegate To: ${chalk.cyan(delegations.join(', '))}`);
            }
        });
    }

    async simulateMultiRoleUser() {
        console.log(chalk.blue('\n--- Multi-Role User Simulation ---'));
        console.log(chalk.gray('Example: Dr. Smith who is both a clinician and business owner\n'));
        
        const userId = 'dr_smith';
        
        // Add Dr. Smith to medical org as clinician
        const medicalOrgId = await this.createTestOrg('Smith Medical Practice', 'llc');
        await this.db.run(
            `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, authority_level, department, title, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [`hier_med_${Date.now()}`, medicalOrgId, userId, 'clinician', 8, 'Medical', 'Chief Medical Officer', Date.now(), Date.now()]
        );

        // Add Dr. Smith to business org as CEO
        const businessOrgId = await this.createTestOrg('Smith Healthcare Ventures', 'corporation');
        await this.db.run(
            `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, authority_level, department, title, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [`hier_biz_${Date.now()}`, businessOrgId, userId, 'ceo', 10, 'Executive', 'Chief Executive Officer', Date.now(), Date.now()]
        );

        console.log(chalk.green(`✅ Created multi-role user: ${userId}`));
        console.log(chalk.gray('Medical Context: Empathetic, patient-focused behavior'));
        console.log(chalk.gray('Business Context: Strategic, profit-focused behavior'));
        console.log(chalk.gray('Smart Context Sharing: Scheduling conflicts, resource constraints\n'));

        // Show their combined permissions
        await this.testPermissions();
    }

    async createTestOrg(name, type) {
        const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await this.db.run(
            `INSERT INTO organizations (id, name, type, settings, created_at) 
             VALUES (?, ?, ?, ?, ?)`,
            [orgId, name, type, '{}', Date.now()]
        );
        return orgId;
    }
}

// Run the CLI
if (import.meta.url === `file://${process.argv[1]}`) {
    const cli = new OrgRoleCLI();
    cli.run().catch(console.error);
}

export { OrgRoleCLI };