/**
 * @fileoverview CLI Batch Testing Tool
 * Provides non-interactive testing of CLI commands for professional circle functionality
 */

import { handleCommand } from '../../handlers/commandHandler.js';
import { findUserByUsername, addUser, createCareCircle } from '../../db/index.js';
import { events } from '../../orchestrator.js';

export class CLIBatchTester {
    constructor() {
        this.testResults = [];
        this.responses = [];
        
        // Listen to system responses
        events.on('broadcast', (data) => {
            this.responses.push({
                timestamp: new Date().toISOString(),
                message: data.reply || data.message,
                from: data.from,
                targetUsers: data.targetUsers
            });
        });
    }

    async setupTestUser(username = 'cli_test_user') {
        try {
            // Check if user exists
            let user = await findUserByUsername(username);
            if (!user) {
                // Create test user
                await addUser(username, username, 'test@example.com', 'patient');
                user = await findUserByUsername(username);
                
                // Create personal care circle
                await createCareCircle(user.user_id, user.user_id);
            }
            return user;
        } catch (error) {
            console.error('[CLIBatchTester] Setup error:', error);
            throw error;
        }
    }

    async testCommand(userId, circleId, command, expectedKeywords = []) {
        console.log(`\n[TEST] Command: ${command}`);
        this.responses = []; // Clear previous responses
        
        try {
            await handleCommand(userId, circleId, command);
            
            // Wait a bit for async responses
            await new Promise(resolve => setTimeout(resolve, 100));
            
            const response = this.responses[this.responses.length - 1]; // Latest response
            const success = response && response.message;
            const hasExpectedContent = expectedKeywords.length === 0 || 
                expectedKeywords.some(keyword => 
                    response?.message?.toLowerCase().includes(keyword.toLowerCase())
                );

            const result = {
                command,
                success,
                hasExpectedContent,
                response: response?.message || 'No response',
                timestamp: new Date().toISOString()
            };
            
            this.testResults.push(result);
            
            console.log(`[RESULT] ${success && hasExpectedContent ? '✅ PASS' : '❌ FAIL'}`);
            console.log(`[RESPONSE] ${result.response}`);
            
            return result;
        } catch (error) {
            console.error(`[TEST ERROR] ${command}:`, error.message);
            const result = {
                command,
                success: false,
                hasExpectedContent: false,
                response: `Error: ${error.message}`,
                timestamp: new Date().toISOString()
            };
            this.testResults.push(result);
            return result;
        }
    }

    async runProfessionalCommandTests() {
        console.log('\n🧪 PROFESSIONAL CIRCLE CLI BATCH TESTING');
        console.log('=' * 50);

        // Setup test user
        const testUser = await this.setupTestUser('pro_test_user');
        const userId = testUser.user_id;
        const circleId = testUser.user_id; // Personal circle

        // Test professional commands
        const tests = [
            {
                command: '/professional',
                expectedKeywords: ['professional', 'circle', 'don\'t have']
            },
            {
                command: '/target alice as project_owner',
                expectedKeywords: ['added', 'professional', 'target']
            },
            {
                command: '/support bob as project_manager',
                expectedKeywords: ['added', 'professional', 'support']
            },
            {
                command: '/expert charlie as technical_architect',
                expectedKeywords: ['added', 'professional', 'expert']
            },
            {
                command: '/professional',
                expectedKeywords: ['professional', 'circle', 'alice', 'bob', 'charlie']
            }
        ];

        // Run tests sequentially
        for (const test of tests) {
            await this.testCommand(userId, circleId, test.command, test.expectedKeywords);
            await new Promise(resolve => setTimeout(resolve, 200)); // Brief delay between tests
        }

        // Summary
        const passed = this.testResults.filter(r => r.success && r.hasExpectedContent).length;
        const total = this.testResults.length;
        
        console.log(`\n📊 TEST SUMMARY`);
        console.log(`Passed: ${passed}/${total} (${Math.round(passed/total*100)}%)`);
        
        if (passed < total) {
            console.log('\n❌ Failed Tests:');
            this.testResults
                .filter(r => !r.success || !r.hasExpectedContent)
                .forEach(r => console.log(`  - ${r.command}: ${r.response}`));
        }

        return { passed, total, results: this.testResults };
    }

    printResults() {
        console.log('\n📋 DETAILED RESULTS:');
        this.testResults.forEach((result, index) => {
            const status = (result.success && result.hasExpectedContent) ? '✅' : '❌';
            console.log(`${index + 1}. ${status} ${result.command}`);
            console.log(`   Response: ${result.response}`);
        });
    }
}

// CLI entry point for standalone testing
if (import.meta.url === `file://${process.argv[1]}`) {
    const tester = new CLIBatchTester();
    try {
        await tester.runProfessionalCommandTests();
        tester.printResults();
    } catch (error) {
        console.error('[CLI Batch Test] Fatal error:', error);
        process.exit(1);
    }
}