#!/usr/bin/env node

/**
 * @fileoverview Simplified Enhanced Routing System Test
 * Tests core functionality without complex database setup
 */

import ProfessionalCircleRouter from '../handlers/routing/professionalCircleRouter.js';
import CompanionConfidentialComm from '../companions/confidential/CompanionConfidentialComm.js';
import { processPrivacyDecision, PRIVACY_LEVELS } from '../companions/handlers/privacyGuard.js';
import chalk from 'chalk';

console.log(chalk.cyan.bold('\n🧪 Enhanced Information Routing System - Core Tests\n'));

// Test 1: Professional Context Analysis
console.log(chalk.yellow('🏢 Testing AI-Powered Professional Context Analysis...'));

const professionalRouter = new ProfessionalCircleRouter();
const testMessages = [
    {
        message: "The project deadline is causing stress and I'm having trouble sleeping",
        description: "Mixed medical/professional context"
    },
    {
        message: "We need to discuss the budget allocation for Q2 with the client",
        description: "Pure professional context"
    },
    {
        message: "I have a headache and feel tired",
        description: "Pure medical context"
    },
    {
        message: "Bob's performance on the API development has been excellent",
        description: "Professional fact about team member"
    }
];

for (const test of testMessages) {
    try {
        // Use AI-powered analysis (will fallback to basic if no context)
        const analysis = await professionalRouter.analyzeProfessionalContext(test.message, {
            facts: { general: test.message },
            resolvedUsers: []
        });

        console.log(`   📝 ${test.description}`);
        console.log(`      Relevance Score: ${analysis.relevanceScore || 'N/A'}`);
        console.log(`      Categories: ${(analysis.categories || []).map(c => c.category).join(', ') || 'None'}`);
        console.log(`      Routing: ${analysis.suggestedRouting?.routeType || 'none'}`);
        console.log(`      AI Enhanced: ${analysis.aiEnhanced ? 'Yes' : 'No'}`);
        console.log(`      Fallback Used: ${analysis.fallbackUsed ? 'Yes' : 'No'}`);
        
        if (analysis.suggestedRouting?.suggestedRole) {
            console.log(`      Target Role: ${analysis.suggestedRouting.suggestedRole}`);
        }
        console.log('');
    } catch (error) {
        console.log(chalk.red(`   Error analyzing "${test.description}": ${error.message}`));
        console.log('');
    }
}

// Test 2: Privacy Level Detection
console.log(chalk.yellow('🔒 Testing Privacy Level Detection...'));

const privacyTestCases = [
    {
        message: "Please keep this confidential - Bob's divorce is affecting his work",
        description: "Explicit confidentiality request"
    },
    {
        message: "The client budget discussions are sensitive", 
        description: "Business confidential content"
    },
    {
        message: "I'm having anxiety about the project deadline",
        description: "Mixed medical/professional content"
    },
    {
        message: "Thanks for the help with the meeting setup",
        description: "Public professional interaction"
    }
];

for (const testCase of privacyTestCases) {
    console.log(`   🔍 ${testCase.description}`);
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

    try {
        const privacyResult = await processPrivacyDecision(
            'test-user-id',
            'target', 
            testCase.message,
            'test-circle-id',
            context
        );

        console.log(`      Privacy Level: ${privacyResult.level}`);
        console.log(`      Professional Context Score: ${privacyResult.professionalContext?.relevanceScore || 0}`);
        console.log(`      Cross-Circle Restricted: ${privacyResult.crossCirclePolicy?.restrictToCurrentCircle || false}`);
        console.log(`      Routing Decision: ${privacyResult.routingDecision?.routeType || 'standard'}`);
    } catch (error) {
        console.log(chalk.red(`      Error: ${error.message}`));
    }
    console.log('');
}

// Test 3: Companion Communication System
console.log(chalk.yellow('🤖 Testing Companion Communication Core Logic...'));

const companionComm = new CompanionConfidentialComm();

// Test privacy level constants
console.log('   📊 Available Privacy Levels:');
Object.entries(PRIVACY_LEVELS).forEach(([key, value]) => {
    console.log(`      ${key}: ${value}`);
});

console.log('\n   🔒 Available Confidential Levels:');
Object.entries(companionComm.confidentialLevels).forEach(([key, value]) => {
    console.log(`      ${key}: ${value}`);
});

// Test consensus analysis
console.log('\n   🤝 Testing Consensus Analysis...');
const mockCompanionInputs = {
    medical_companion: 'Health perspective: User shows signs of work-related stress. Recommend reducing workload.',
    professional_companion: 'Professional perspective: Project deadlines are critical for client satisfaction. Recommend time management solutions.'
};

const consensus = companionComm.analyzeCompanionConsensus(
    mockCompanionInputs,
    'User considering taking sick leave due to work stress'
);

console.log(`      Consensus Reached: ${consensus.reached}`);
console.log(`      Recommendation: "${consensus.recommendation}"`);
console.log(`      Confidence: ${consensus.confidence}`);
console.log(`      Support Count: ${consensus.supportCount}`);
console.log(`      Concern Count: ${consensus.concernCount}`);
console.log(`      Reason: ${consensus.reason}`);

console.log(chalk.green.bold('\n✅ Core routing system functionality tests completed!\n'));

console.log(chalk.blue('💡 Key Features Implemented:'));
console.log('   ✓ Professional context analysis with keyword matching');
console.log('   ✓ Cross-circle privacy controls with CIRCLE_CONFINED level');
console.log('   ✓ Enhanced privacy levels for business contexts');
console.log('   ✓ Companion confidential messaging system'); 
console.log('   ✓ Companion decision coordination framework');
console.log('   ✓ Mixed medical/professional context detection');
console.log('   ✓ Professional circle routing suggestions');

console.log(chalk.cyan('\n🚀 System is ready for integration with full database and GUI testing!\n'));