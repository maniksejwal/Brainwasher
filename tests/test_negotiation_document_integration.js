#!/usr/bin/env node

/**
 * Test Negotiation-Document Integration
 * Test companion-to-companion document negotiation with privacy controls
 */

import { NegotiationDocumentIntegrator } from '../agents/business/negotiationDocumentIntegrator.js';
import { DocumentAgent } from '../agents/business/documentAgent.js';
import { getDb } from '../db/connection.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import chalk from 'chalk';

async function testNegotiationDocumentIntegration() {
    console.log(chalk.green('🤝 Testing Negotiation-Document Integration System'));
    console.log(chalk.gray('Testing companion-to-companion document negotiation with autonomous decision making\n'));

    const db = await getDb();
    await initializeBusinessSchema(db);

    const orgId = await setupTestEnvironment(db);

    // Set up negotiating parties
    const buyerProfile = {
        businessProfile: {
            roles: [{
                role: 'ceo',
                title: 'CEO',
                org_name: 'TechCorp',
                behaviorMode: 'strategic'
            }]
        }
    };

    const sellerProfile = {
        businessProfile: {
            roles: [{
                role: 'sales_manager',
                title: 'Sales Director',
                org_name: 'MedEquipment Inc',
                behaviorMode: 'competitive'
            }]
        }
    };

    try {
        console.log(chalk.blue('📝 Test 1: Document Creation for Negotiation'));
        
        // Create negotiable document
        const docAgent = new DocumentAgent('seller_user', sellerProfile);
        const docId = await docAgent.createDocument(
            'Equipment Purchase Agreement - MRI System',
            `# Equipment Purchase Agreement

## Product Specifications
- **Equipment**: Siemens MAGNETOM MRI System
- **Model**: [REQUIRES_APPROVAL]Vida 3T Premium[/REQUIRES_APPROVAL]
- **Price**: $1,500,000
- **Delivery Timeline**: 120 days
- **Payment Terms**: 50% upfront, 50% on delivery

## Service Agreement
- **Warranty**: 5 years comprehensive coverage
- **Training**: Included for 8 technicians
- **Maintenance**: [SENSITIVE]$75,000 annual maintenance contract[/SENSITIVE]

## Terms and Conditions
- **Delivery penalty**: 2% per week for delays beyond 120 days
- **Acceptance criteria**: 30-day testing period
- **Cancellation terms**: [REQUIRES_APPROVAL]10% penalty for cancellation[/REQUIRES_APPROVAL]

## Signatures
- [ ] Buyer approval
- [ ] Legal review completed
- [ ] Finance sign-off

*This document is subject to negotiation and final approval.*`,
            orgId
        );

        console.log(chalk.green(`✅ Created negotiable document: ${docId.substring(0, 8)}`));

        console.log(chalk.blue('\n📝 Test 2: Initialize Document Negotiation'));
        
        // Initialize negotiation integrators for both parties
        const buyerIntegrator = new NegotiationDocumentIntegrator('buyer_user', buyerProfile, {
            autonomyLevel: 'supervised',
            constraints: { maxBudget: 1200000, maxDeliveryDays: 90 },
            role: 'buyer',
            autonomousPermissions: ['negotiate_terms', 'propose_changes']
        });

        const sellerIntegrator = new NegotiationDocumentIntegrator('seller_user', sellerProfile, {
            autonomyLevel: 'supervised',
            constraints: { minPrice: 1300000, minDeliveryDays: 100 },
            role: 'seller',
            autonomousPermissions: ['negotiate_terms', 'counter_proposals']
        });

        // Start negotiation session
        const negotiationSession = await buyerIntegrator.startDocumentNegotiation(
            docId,
            'seller_user',
            {
                myRole: 'buyer',
                counterpartyRole: 'seller',
                privacyLevel: 'internal',
                constraints: { maxBudget: 1200000, urgency: 'high' }
            }
        );

        console.log(chalk.green(`✅ Started negotiation session: ${negotiationSession.sessionId.substring(0, 8)}`));
        console.log(chalk.gray(`Document: ${negotiationSession.documentId.substring(0, 8)}`));
        console.log(chalk.gray(`Negotiable terms identified: ${negotiationSession.negotiableTerms.length}`));
        console.log(chalk.gray(`Participants: ${negotiationSession.participants.join(', ')}`));

        // Display negotiable terms
        console.log(chalk.yellow('\n📋 Negotiable Terms Identified:'));
        negotiationSession.negotiableTerms.slice(0, 5).forEach((term, i) => {
            const priorityColor = term.priority === 'critical' ? chalk.red : 
                                 term.priority === 'high' ? chalk.yellow : chalk.gray;
            console.log(`  ${i + 1}. ${priorityColor(term.type.toUpperCase())}: "${term.value}" (${term.priority})`);
            console.log(`     Negotiable: ${term.negotiable ? '✅' : '❌'}`);
        });

        console.log(chalk.blue('\n📝 Test 3: Autonomous Term Negotiation'));
        
        // Buyer proposes changes
        const buyerProposedChanges = [
            {
                type: 'price',
                value: '$1,200,000',
                originalValue: '$1,500,000',
                reasoning: 'Budget constraint - maximum approved budget'
            },
            {
                type: 'date',
                value: '90 days',
                originalValue: '120 days',
                reasoning: 'Urgent need for equipment installation'
            }
        ];

        console.log(chalk.yellow('💬 Buyer proposes changes:'));
        buyerProposedChanges.forEach(change => {
            console.log(`  ${change.type}: ${change.originalValue} → ${chalk.cyan(change.value)}`);
            console.log(`     Reasoning: ${change.reasoning}`);
        });

        // Seller's autonomous response
        const sellerResponse = await sellerIntegrator.negotiateDocumentTerms(
            negotiationSession.sessionId,
            buyerProposedChanges,
            buyerIntegrator
        );

        console.log(chalk.green(`✅ Seller autonomous response: ${chalk.cyan(sellerResponse.decision.toUpperCase())}`));
        console.log(chalk.gray(`Terms modified: ${sellerResponse.termsModified?.length || 0}`));
        console.log(chalk.gray(`Requires human approval: ${sellerResponse.requiresHumanApproval}`));
        console.log(chalk.gray(`Next actions: ${sellerResponse.nextActions?.join(', ')}`));

        console.log(chalk.blue('\n📝 Test 4: Collaborative Document Editing'));
        
        // Test real-time collaborative editing during negotiation
        const collaborationActions = [
            {
                type: 'propose_edit',
                lineNumber: 6,
                originalText: '$1,500,000',
                proposedText: '$1,350,000',
                reasoning: 'Counter-proposal - meeting halfway on price'
            },
            {
                type: 'add_comment',
                lineNumber: 8,
                comment: 'Can we discuss expedited delivery options for 90-day timeline?'
            }
        ];

        console.log(chalk.yellow('\n💬 Collaborative Editing Actions:'));
        for (const action of collaborationActions) {
            const result = await sellerIntegrator.collaborateDuringNegotiation(
                negotiationSession.sessionId,
                action,
                buyerIntegrator
            );
            
            console.log(`  ${action.type}: ${chalk.green(result.status)}`);
            if (action.type === 'propose_edit') {
                console.log(`     ${action.originalText} → ${chalk.cyan(action.proposedText)}`);
                console.log(`     Reasoning: ${action.reasoning}`);
                console.log(`     Requires response: ${result.requiresCounterpartyResponse || false}`);
            }
        }

        console.log(chalk.blue('\n📝 Test 5: Privacy-Controlled Information Exchange'));
        
        // Test privacy filtering during negotiation
        const sensitiveNegotiation = await buyerIntegrator.negotiateDocumentTerms(
            negotiationSession.sessionId,
            [{
                type: 'sensitive',
                value: '$75,000 annual maintenance contract',
                reasoning: 'Need to reduce maintenance costs - internal budget constraint'
            }],
            sellerIntegrator
        );

        console.log(chalk.yellow('\n🔐 Privacy-Controlled Negotiation:'));
        console.log(`  Decision: ${chalk.cyan(sensitiveNegotiation.decision)}`);
        console.log(`  Privacy filtered: ${sensitiveNegotiation.privacyFiltered || 'Not specified'}`);
        console.log(`  Human approval required: ${sensitiveNegotiation.requiresHumanApproval}`);

        console.log(chalk.blue('\n📝 Test 6: Negotiation Audit Trail'));
        
        // Check negotiation audit trail
        const auditTrail = await db.all(`
            SELECT action_type, user_id, metadata, privacy_level, timestamp
            FROM autonomous_actions 
            WHERE action_type LIKE 'negotiation%' OR action_type LIKE 'autonomous_negotiation%'
            ORDER BY timestamp DESC
        `);

        console.log(chalk.yellow(`\n📋 Negotiation Audit Trail (${auditTrail.length} actions):`));
        auditTrail.slice(0, 4).forEach((action, i) => {
            const metadata = JSON.parse(action.metadata);
            console.log(`  ${i + 1}. ${chalk.cyan(action.action_type)} - ${action.user_id}`);
            console.log(`     Time: ${new Date(action.timestamp).toLocaleTimeString()}`);
            console.log(`     Session: ${metadata.sessionId?.substring(0, 8) || 'N/A'}`);
            console.log(`     Document: ${metadata.documentId?.substring(0, 8) || 'N/A'}`);
            if (metadata.termsModified) {
                console.log(`     Terms modified: ${metadata.termsModified}`);
            }
        });

        console.log(chalk.blue('\n📝 Test 7: Document Comments During Negotiation'));
        
        // Check negotiation comments
        const comments = await db.all(`
            SELECT user_id, comment, line_number, created_at
            FROM doc_comments
            WHERE doc_id = ?
            ORDER BY created_at DESC
        `, [docId]);

        console.log(chalk.yellow(`\n💬 Negotiation Comments (${comments.length} total):`));
        comments.forEach((comment, i) => {
            const commentData = JSON.parse(comment.comment);
            console.log(`  ${i + 1}. ${comment.user_id} (Line ${comment.line_number || 'N/A'})`);
            console.log(`     Type: ${commentData.type}`);
            console.log(`     Content: ${commentData.content || 'N/A'}`);
            if (commentData.proposedText) {
                console.log(`     Proposed: ${commentData.originalText} → ${commentData.proposedText}`);
            }
            console.log(`     Time: ${new Date(comment.created_at).toLocaleString()}`);
        });

        console.log(chalk.green('\n🎉 Negotiation-Document Integration test completed!'));
        console.log(chalk.yellow('\n💡 Key Features Demonstrated:'));
        console.log('   ✅ Companion-to-companion document negotiation');
        console.log('   ✅ Autonomous term extraction and analysis');
        console.log('   ✅ Game-theoretic negotiation responses');
        console.log('   ✅ Real-time collaborative editing during negotiation');
        console.log('   ✅ Privacy-controlled information exchange');
        console.log('   ✅ Comprehensive negotiation audit trails');
        console.log('   ✅ Contextual comments tied to negotiation sessions');
        console.log('   ✅ Human oversight integration for sensitive terms');

        console.log(chalk.blue('\n🤖 Autonomous Negotiation Features:'));
        console.log('   🧠 Strategic term analysis with financial/timeline impact');
        console.log('   ⚡ Real-time companion-to-companion negotiation');
        console.log('   🔐 Privacy filtering for sensitive negotiations');
        console.log('   📊 Game-theoretic decision making');
        console.log('   👥 Multi-party collaborative document editing');
        console.log('   🔍 Complete audit trail for all autonomous decisions');

        return { 
            success: true, 
            negotiationSessionCreated: true,
            termsNegotiated: buyerProposedChanges.length,
            collaborativeActionsCompleted: collaborationActions.length,
            auditTrailEntries: auditTrail.length
        };

    } catch (error) {
        console.error(chalk.red('❌ Test failed:'), error.message);
        console.error(error.stack);
        return { success: false, error: error.message };
    }
}

async function setupTestEnvironment(db) {
    const orgId = `org_negotiation_test_${Date.now()}`;
    
    await db.run(
        `INSERT INTO organizations (id, name, type, settings, created_at) 
         VALUES (?, ?, ?, ?, ?)`,
        [orgId, 'Negotiation Test Organization', 'corporation', JSON.stringify({
            negotiationRules: {
                autonomousNegotiation: 'supervised',
                privacyLevel: 'internal',
                requiresApproval: ['sensitive_terms', 'financial_terms']
            }
        }), Date.now()]
    );

    // Set up negotiating users
    const users = [
        { userId: 'buyer_user', role: 'ceo', title: 'CEO - TechCorp' },
        { userId: 'seller_user', role: 'sales_manager', title: 'Sales Director - MedEquipment' }
    ];

    for (const user of users) {
        const hierId = `hier_${Date.now()}_${user.userId}`;
        await db.run(
            `INSERT OR REPLACE INTO org_hierarchies (id, org_id, user_id, role, title, authority_level, department, start_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [hierId, orgId, user.userId, user.role, user.title, 9, 'Executive', Date.now(), Date.now()]
        );
    }

    console.log(chalk.green(`✅ Set up negotiation test environment: ${orgId}`));
    return orgId;
}

// Run the test
testNegotiationDocumentIntegration().catch(console.error);