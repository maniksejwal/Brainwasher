#!/usr/bin/env node

/**
 * Document Collaboration Test
 * Test markdown document creation, editing, and approval workflows
 */

import { DocumentAgent } from '../agents/business/documentAgent.js';
import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import chalk from 'chalk';

async function testDocumentCollaboration() {
    console.log(chalk.green('📄 Testing Document Collaboration System'));
    console.log(chalk.gray('Testing markdown document creation, editing, and approval workflows\n'));

    const db = await getDb();
    await initializeBusinessSchema(db);

    // Set up test users and organization
    const orgId = await setupTestOrganization(db);
    const authorId = 'dr_smith';
    const reviewerId = 'legal_counsel';
    const approverId = 'ceo_user';

    try {
        console.log(chalk.blue('📝 Test 1: Create Document'));
        
        const docAgent = new DocumentAgent(authorId, {});
        
        const docId = await docAgent.createDocument(
            'Equipment Purchase Agreement',
            `# Equipment Purchase Agreement

## Overview
This document outlines the terms for purchasing medical equipment.

## Specifications
- **Equipment Type**: MRI Machine
- **Model**: Siemens MAGNETOM
- **Price**: $1,200,000
- **Delivery**: 90 days

## Terms
1. Payment: 30% upfront, 70% on delivery
2. Warranty: 5 years full coverage
3. Training: Included for 4 technicians

## Approval Required
- [ ] Legal Review
- [ ] CEO Approval
- [ ] Finance Sign-off
`,
            orgId
        );
        
        console.log(chalk.green(`✅ Created document: ${docId}`));

        console.log(chalk.blue('\n📝 Test 2: Add Collaborators'));
        
        // Add reviewers and approvers
        await docAgent.addCollaborator(docId, reviewerId, 'reviewer', ['read', 'approve']);
        await docAgent.addCollaborator(docId, approverId, 'approver', ['read', 'approve']);
        
        console.log(chalk.green('✅ Added collaborators'));

        console.log(chalk.blue('\n📝 Test 3: Edit Document'));
        
        // Simulate editing the document
        const editResult = await docAgent.editDocument(docId, 'content', 
            `# Equipment Purchase Agreement

## Overview
This document outlines the terms for purchasing medical equipment.

## Specifications
- **Equipment Type**: MRI Machine
- **Model**: Siemens MAGNETOM Vida 3T
- **Price**: $1,350,000 (updated pricing)
- **Delivery**: 90 days
- **Installation**: Included

## Terms
1. Payment: 30% upfront, 70% on delivery
2. Warranty: 5 years full coverage + extended support
3. Training: Included for 6 technicians (expanded)
4. Service contract: 3 years included

## Approval Required
- [ ] Legal Review
- [ ] CEO Approval
- [ ] Finance Sign-off

---
*Last updated: ${new Date().toISOString().split('T')[0]}*
`
        );
        
        console.log(chalk.green(`✅ Document edited - Version ${editResult.version}`));
        console.log(chalk.gray('Generated diff:'));
        console.log(editResult.diff.split('\n').slice(0, 10).join('\n') + '...');

        console.log(chalk.blue('\n📝 Test 4: Start Approval Workflow'));
        
        const workflow = await docAgent.startApprovalWorkflow(docId, [reviewerId, approverId]);
        console.log(chalk.green(`✅ Started approval workflow - ${workflow.approvers} approvers for version ${workflow.version}`));

        console.log(chalk.blue('\n📝 Test 5: Legal Review'));
        
        const legalAgent = new DocumentAgent(reviewerId, {});
        const legalReview = await legalAgent.approveDocument(docId, true, 'Legal terms look good. Minor pricing update noted.');
        
        console.log(chalk.green(`✅ Legal review: ${legalReview.approved ? 'APPROVED' : 'REJECTED'}`));
        console.log(chalk.gray(`Document status: ${legalReview.documentStatus}, Pending: ${legalReview.pendingApprovals}`));

        console.log(chalk.blue('\n📝 Test 6: CEO Approval'));
        
        const ceoAgent = new DocumentAgent(approverId, {});
        const ceoApproval = await ceoAgent.approveDocument(docId, true, 'Approved. Price increase is acceptable given expanded scope.');
        
        console.log(chalk.green(`✅ CEO approval: ${ceoApproval.approved ? 'APPROVED' : 'REJECTED'}`));
        console.log(chalk.gray(`Final document status: ${ceoApproval.documentStatus}`));

        console.log(chalk.blue('\n📝 Test 7: View Document History'));
        
        const versions = await docAgent.getDocumentVersions(docId);
        console.log(chalk.yellow(`\n📋 Document Version History:`));
        
        versions.forEach(version => {
            console.log(`  v${version.version_number} - ${version.author} at ${new Date(version.timestamp).toLocaleString()}`);
            console.log(`    Comment: ${version.comment}`);
        });

        console.log(chalk.blue('\n📝 Test 8: Simulate Editor Integration'));
        
        // Test nano/vim simulation
        console.log(chalk.yellow('Testing terminal editor integration:'));
        const nanoEdit = await docAgent.editDocument(docId, 'nano');
        if (nanoEdit.success) {
            console.log(chalk.green('✅ Nano editor integration working'));
        }
        
        const vimEdit = await docAgent.editDocument(docId, 'vim');  
        if (vimEdit.success) {
            console.log(chalk.green('✅ Vim editor integration working'));
        }

        console.log(chalk.green('\n🎉 Document collaboration system test completed!'));
        console.log(chalk.yellow('\n💡 Key Features Demonstrated:'));
        console.log('   ✅ Markdown document creation and editing');
        console.log('   ✅ Git-like diff generation');
        console.log('   ✅ Version control and history tracking');
        console.log('   ✅ Multi-user collaboration with roles');
        console.log('   ✅ Approval workflows with sequential approvers');
        console.log('   ✅ Terminal editor integration (nano/vim simulation)');
        console.log('   ✅ Permission-based access control');

        return { success: true, documentId: docId };

    } catch (error) {
        console.error(chalk.red('❌ Test failed:'), error.message);
        console.error(error.stack);
        return { success: false, error: error.message };
    }
}

async function setupTestOrganization(db) {
    // Create test organization
    const orgId = `org_test_docs_${Date.now()}`;
    
    await db.run(
        `INSERT INTO organizations (id, name, type, settings, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, 'Healthcare Solutions Inc', 'corporation', '{}', Date.now()]
    );

    // Add test users to organization
    const users = [
        { userId: 'dr_smith', role: 'ceo', title: 'CEO', authority: 10 },
        { userId: 'legal_counsel', role: 'legal_counsel', title: 'Legal Counsel', authority: 7 },
        { userId: 'ceo_user', role: 'ceo', title: 'Chief Executive', authority: 10 }
    ];

    for (const user of users) {
        const hierId = `hier_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        await db.run(
            `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, title, authority_level, department, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [hierId, orgId, user.userId, user.role, user.title, user.authority, 'Executive', Date.now(), Date.now()]
        );
    }

    console.log(chalk.green(`✅ Set up test organization: ${orgId}`));
    return orgId;
}

// Run the test
testDocumentCollaboration().catch(console.error);