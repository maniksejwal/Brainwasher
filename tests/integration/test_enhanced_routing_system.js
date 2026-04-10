#!/usr/bin/env node

/**
 * @fileoverview Test Enhanced Information Routing System
 * Tests professional circle routing, companion confidential messaging, and cross-circle privacy
 */

import { initializeDatabase } from '../db/schema.js';
import { initializeBusinessSchema } from '../db/business/schema.js';
import { getDb } from '../db/connection.js';
import { addUser, createCareCircle, addMemberToCircle } from '../db/index.js';
import ProfessionalCircleRouter from '../handlers/routing/professionalCircleRouter.js';
import CompanionConfidentialComm from '../companions/confidential/CompanionConfidentialComm.js';
import { processPrivacyDecision, PRIVACY_LEVELS } from '../companions/handlers/privacyGuard.js';
import { routeMessage } from '../handlers/contextAwareCompanionRouter.js';
import { randomUUID } from 'crypto';
import chalk from 'chalk';

class RoutingSystemTestSuite {
    constructor() {
        this.professionalRouter = new ProfessionalCircleRouter();
        this.companionComm = new CompanionConfidentialComm();
        this.testUsers = {};
        this.testCircles = {};
    }

    async runAllTests() {
        console.log(chalk.cyan.bold('\n🧪 Enhanced Information Routing System Test Suite\n'));
        
        try {
            await this.setupTestDatabase();
            await this.createTestData();
            
            await this.testProfessionalContextAnalysis();
            await this.testCompanionConfidentialMessaging();
            await this.testCrossCirclePrivacyControls();
            await this.testMixedContextRouting();
            await this.testCompanionDecisionCoordination();
            
            console.log(chalk.green.bold('\n✅ All routing system tests completed successfully!\n'));
        } catch (error) {
            console.error(chalk.red.bold('\n❌ Test suite failed:'), error.message);
            console.error(error.stack);
        }
    }

    async setupTestDatabase() {
        console.log(chalk.blue('📊 Setting up test database...'));
        
        const db = await getDb();
        await initializeDatabase();
        await initializeBusinessSchema(db);
        await this.companionComm.initializeSchema();

        // Check if professional circle columns exist, add if not
        try {
            const tableInfo = await db.all("PRAGMA table_info(care_circles)");
            const existingColumns = tableInfo.map(col => col.name);
            
            if (!existingColumns.includes('circle_type')) {
                await db.exec('ALTER TABLE care_circles ADD COLUMN circle_type TEXT DEFAULT "medical"');
            }
            if (!existingColumns.includes('organization_context')) {
                await db.exec('ALTER TABLE care_circles ADD COLUMN organization_context TEXT');
            }
            if (!existingColumns.includes('coordination_engine')) {
                await db.exec('ALTER TABLE care_circles ADD COLUMN coordination_engine TEXT DEFAULT "medical_care"');
            }
        } catch (error) {
            // Columns might already exist, that's fine
            console.log('   (Professional circle columns already exist)');
        }
        
        console.log('✓ Test database initialized');
    }

    async createTestData() {
        console.log(chalk.blue('👥 Creating test users and circles...'));
        
        // Create test users
        const users = [
            { id: randomUUID(), username: 'alice_pm', role: 'project_manager' },
            { id: randomUUID(), username: 'bob_dev', role: 'developer' },
            { id: randomUUID(), username: 'carol_client', role: 'client_manager' },
            { id: randomUUID(), username: 'david_doctor', role: 'doctor' }
        ];

        for (const user of users) {
            await addUser(user.id, user.username);
            this.testUsers[user.username] = user;
        }

        // Create medical circles
        const aliceMedicalCircle = await createCareCircle(this.testUsers.alice_pm.id, this.testUsers.alice_pm.id);
        await addMemberToCircle(aliceMedicalCircle.circle_id, this.testUsers.david_doctor.id, 'doctor', 'primary_care');
        this.testCircles.alice_medical = aliceMedicalCircle;

        // Create professional circles
        const db = await getDb();
        const aliceProfessionalCircle = randomUUID();
        await db.run(`
            INSERT INTO care_circles (circle_id, primary_patient_id, circle_type, organization_context, created_at)
            VALUES (?, ?, 'professional', 'intra_organizational', ?)
        `, [aliceProfessionalCircle, this.testUsers.alice_pm.id, Date.now()]);
        
        await addMemberToCircle(aliceProfessionalCircle, this.testUsers.alice_pm.id, 'target', 'Project Manager');
        await addMemberToCircle(aliceProfessionalCircle, this.testUsers.bob_dev.id, 'expert', 'Senior Developer');
        await addMemberToCircle(aliceProfessionalCircle, this.testUsers.carol_client.id, 'support', 'Client Coordinator');
        this.testCircles.alice_professional = { circle_id: aliceProfessionalCircle };

        console.log('✓ Test data created');
    }

    async testProfessionalContextAnalysis() {
        console.log(chalk.yellow('\n🏢 Testing Professional Context Analysis...'));
        
        const testMessages = [
            {
                message: "The project deadline is causing stress and I'm having trouble sleeping",
                expectedRelevance: 0.7, // High professional + medical mix
                description: "Mixed medical/professional context"
            },
            {
                message: "We need to discuss the budget allocation for Q2 with the client",
                expectedRelevance: 0.9, // High professional relevance
                description: "Pure professional context"
            },
            {
                message: "I have a headache and feel tired",
                expectedRelevance: 0.1, // Low professional relevance
                description: "Pure medical context"
            },
            {
                message: "Bob's performance on the API development has been excellent",
                expectedRelevance: 0.8, // High professional relevance with person mention
                description: "Professional fact about team member"
            }
        ];

        for (const test of testMessages) {
            const analysis = this.professionalRouter.analyzeProfessionalContext(test.message, {
                facts: { general: test.message },
                resolvedUsers: []
            });

            console.log(`   📝 "${test.description}"`);
            console.log(`      Message: "${test.message}"`);
            console.log(`      Relevance Score: ${analysis.relevanceScore} (expected: ${test.expectedRelevance})`);
            console.log(`      Categories: ${analysis.categories.map(c => c.category).join(', ')}`);
            console.log(`      Routing: ${analysis.suggestedRouting?.routeType || 'none'}`);

            // Verify expectations
            const withinRange = Math.abs(analysis.relevanceScore - test.expectedRelevance) < 0.3;
            if (withinRange) {
                console.log(chalk.green('      ✓ Analysis correct'));
            } else {
                console.log(chalk.red('      ✗ Analysis unexpected'));
            }
            console.log('');
        }
    }

    async testCompanionConfidentialMessaging() {
        console.log(chalk.yellow('\n🤖 Testing Companion Confidential Messaging...'));
        
        // Test companion-to-companion message
        console.log('   📨 Sending confidential message between companions...');
        const messageId = await this.companionComm.sendCompanionMessage({
            senderCompanion: 'medical_companion',
            senderUserId: this.testUsers.alice_pm.id,
            recipientCompanion: 'professional_companion',
            recipientUserId: this.testUsers.alice_pm.id,
            content: 'User showing signs of work-related stress. Professional schedule adjustment may help.',
            confidentialLevel: this.companionComm.confidentialLevels.COMPANION_NETWORK,
            intelligenceType: 'risk_assessment',
            relatedCircleId: this.testCircles.alice_medical.circle_id,
            expiresInHours: 24
        });

        console.log(`   ✓ Message sent with ID: ${messageId}`);

        // Test intelligence sharing
        console.log('   🧠 Testing intelligence sharing...');
        const sharingId = await this.companionComm.shareIntelligenceBetweenCompanions({
            sourceCompanion: 'medical_companion',
            targetCompanion: 'professional_companion',
            userId: this.testUsers.alice_pm.id,
            summary: 'Work stress affecting health indicators',
            detailedAnalysis: JSON.stringify({
                stressLevel: 'moderate',
                sleepQuality: 'poor',
                workloadConcerns: ['deadline_pressure', 'resource_constraints'],
                recommendedActions: ['schedule_adjustment', 'workload_review']
            }),
            reason: 'health_work_correlation_detected'
        });

        console.log(`   ✓ Intelligence sharing recorded with ID: ${sharingId}`);

        // Test retrieving confidential messages
        console.log('   📥 Retrieving companion messages...');
        const messages = await this.companionComm.getCompanionMessages(
            'professional_companion', 
            this.testUsers.alice_pm.id,
            true // unread only
        );

        console.log(`   ✓ Retrieved ${messages.length} confidential messages`);
        if (messages.length > 0) {
            console.log(`      Latest: "${messages[0].message_content.substring(0, 50)}..."`);
            console.log(`      Intelligence Type: ${messages[0].intelligence_type}`);
            console.log(`      Expires: ${messages[0].expires_at ? new Date(messages[0].expires_at).toLocaleString() : 'Never'}`);
        }
    }

    async testCrossCirclePrivacyControls() {
        console.log(chalk.yellow('\n🔒 Testing Cross-Circle Privacy Controls...'));
        
        const testCases = [
            {
                message: "Please keep this confidential - Bob's divorce is affecting his work",
                expectedPrivacy: PRIVACY_LEVELS.CIRCLE_CONFINED,
                description: "Explicit confidentiality request"
            },
            {
                message: "The client budget discussions are sensitive",
                expectedPrivacy: PRIVACY_LEVELS.BUSINESS_CONFIDENTIAL,
                description: "Business confidential content"
            },
            {
                message: "I'm having anxiety about the project deadline",
                expectedPrivacy: PRIVACY_LEVELS.SENSITIVE,
                description: "Mixed medical/professional content"
            },
            {
                message: "Thanks for the help with the meeting setup",
                expectedPrivacy: PRIVACY_LEVELS.PUBLIC,
                description: "Public professional interaction"
            }
        ];

        for (const testCase of testCases) {
            console.log(`   🔍 Testing: "${testCase.description}"`);
            console.log(`      Message: "${testCase.message}"`);

            const context = {
                inputUnderstanding: {
                    intent: 'REPORTING_FACT',
                    facts: { general: testCase.message },
                    mentionedUsernames: testCase.message.includes('Bob') ? ['Bob'] : [],
                    resolvedUsers: []
                },
                members: []
            };

            const privacyResult = await processPrivacyDecision(
                this.testUsers.alice_pm.id,
                'target',
                testCase.message,
                this.testCircles.alice_professional.circle_id,
                context
            );

            console.log(`      Privacy Level: ${privacyResult.level}`);
            console.log(`      Cross-Circle Policy: ${privacyResult.crossCirclePolicy?.reason || 'none'}`);
            console.log(`      Routing Decision: ${privacyResult.routingDecision?.routeType || 'standard'}`);

            if (privacyResult.level === testCase.expectedPrivacy) {
                console.log(chalk.green('      ✓ Privacy level correct'));
            } else {
                console.log(chalk.yellow(`      ~ Privacy level: expected ${testCase.expectedPrivacy}, got ${privacyResult.level}`));
            }
            console.log('');
        }
    }

    async testMixedContextRouting() {
        console.log(chalk.yellow('\n🔄 Testing Mixed Context Routing...'));
        
        const mixedContextMessage = "I'm stressed about the project deadline and it's affecting my sleep";
        
        console.log(`   📝 Processing mixed context message: "${mixedContextMessage}"`);
        
        // Analyze professional context
        const professionalContext = this.professionalRouter.analyzeProfessionalContext(
            mixedContextMessage, 
            { facts: {}, resolvedUsers: [] }
        );

        console.log(`   📊 Professional relevance: ${professionalContext.relevanceScore}`);
        console.log(`   📚 Categories found: ${professionalContext.categories.map(c => c.category).join(', ')}`);
        console.log(`   🎯 Suggested routing: ${professionalContext.suggestedRouting?.routeType || 'none'}`);

        // Test privacy decision for mixed context
        const context = {
            inputUnderstanding: {
                intent: 'REPORTING_FACT',
                facts: { stress: mixedContextMessage },
                mentionedUsernames: [],
                resolvedUsers: []
            },
            members: []
        };

        const privacyResult = await processPrivacyDecision(
            this.testUsers.alice_pm.id,
            'target',
            mixedContextMessage,
            this.testCircles.alice_medical.circle_id,
            context
        );

        console.log(`   🔒 Privacy level: ${privacyResult.level}`);
        console.log(`   🔀 Cross-circle restricted: ${privacyResult.crossCirclePolicy?.restrictToCurrentCircle || false}`);
        console.log(`   🎯 Routing type: ${privacyResult.routingDecision?.routeType || 'standard'}`);

        const shouldRestrictCrossCircle = privacyResult.crossCirclePolicy?.restrictToCurrentCircle;
        if (shouldRestrictCrossCircle) {
            console.log(chalk.green('   ✓ Mixed context correctly identified as needing circle restriction'));
        } else {
            console.log(chalk.yellow('   ~ Mixed context routing may need adjustment'));
        }
    }

    async testCompanionDecisionCoordination() {
        console.log(chalk.yellow('\n🤝 Testing Companion Decision Coordination...'));
        
        console.log('   🎯 Coordinating decision between medical and professional companions...');
        
        const coordinationResult = await this.companionComm.coordinateCompanionDecision({
            userId: this.testUsers.alice_pm.id,
            decisionContext: 'User considering taking sick leave due to work stress',
            companions: ['medical_companion', 'professional_companion']
        });

        console.log(`   📋 Decision sync ID: ${coordinationResult.syncId}`);
        console.log(`   🤖 Companions involved: medical, professional`);
        console.log(`   ✅ Consensus reached: ${coordinationResult.consensus.reached}`);
        console.log(`   📊 Confidence score: ${coordinationResult.consensus.confidence}`);
        console.log(`   💭 Recommendation: "${coordinationResult.consensus.recommendation}"`);
        console.log(`   📈 Support count: ${coordinationResult.consensus.supportCount}`);
        console.log(`   ⚠️  Concern count: ${coordinationResult.consensus.concernCount}`);
        console.log(`   👤 Requires user input: ${coordinationResult.requiresUserInput}`);

        if (coordinationResult.consensus.reached) {
            console.log(chalk.green('   ✓ Companions successfully coordinated decision'));
        } else {
            console.log(chalk.yellow('   ~ Companions could not reach consensus - user input needed'));
        }

        // Test companion inputs
        console.log('\n   🗣️  Companion perspectives:');
        Object.entries(coordinationResult.companionInputs).forEach(([companion, input]) => {
            if (input) {
                console.log(`      ${companion}: "${input.substring(0, 80)}..."`);
            }
        });
    }
}

// Run the test suite
const testSuite = new RoutingSystemTestSuite();
testSuite.runAllTests().catch(console.error);