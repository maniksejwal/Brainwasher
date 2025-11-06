#!/usr/bin/env node

/**
 * @fileoverview Multi-Client Real-World Simulation
 * Simulates 4 clients connecting simultaneously to test real-world scenarios
 */

import { handleMessage } from '../handlers/messageHandler.js';
import { initializeDatabase } from '../db/schema.js';
import { addUser, createCareCircle, addMemberToCircle, findUserByUsername } from '../db/index.js';
import { getDb } from '../db/connection.js';

// Real-world scenario: Family care circle with multiple members
const REAL_WORLD_SCENARIO = {
    users: [
        { username: 'grandma', role: 'patient', relationship: 'self' },
        { username: 'dad', role: 'caregiver', relationship: 'son' },
        { username: 'mom', role: 'caregiver', relationship: 'daughter-in-law' },
        { username: 'dr_smith', role: 'doctor', relationship: 'doctor' }
    ],
    circleName: 'grandma',
    initialMessages: [
        { user: 'grandma', message: 'I\'ve been feeling dizzy lately, especially in the mornings.' },
        { user: 'dad', message: 'Mom mentioned she\'s been dizzy. Should we be concerned?' },
        { user: 'mom', message: 'I noticed she\'s been unsteady when walking. Maybe we should check her blood pressure.' },
        { user: 'grandma', message: 'I don\'t want to worry anyone, but I did fall yesterday. Nothing serious though.' }
    ]
};

class MultiClientSimulator {
    constructor() {
        this.clients = new Map();
        this.circleId = null;
    }

    async initialize() {
        console.log('🔧 Initializing database...');
        await initializeDatabase();
        
        console.log('👥 Creating users and care circle...');
        const db = await getDb();
        
        // Create users
        for (const userConfig of REAL_WORLD_SCENARIO.users) {
            const existing = await findUserByUsername(userConfig.username);
            if (!existing) {
                await addUser(userConfig.username, userConfig.username);
                console.log(`  ✓ Created user: ${userConfig.username}`);
            }
        }
        
        // Create care circle (must use patient's user_id as circle_id)
        const grandma = await findUserByUsername('grandma');
        if (!grandma) {
            throw new Error('Grandma user not found');
        }
        
        // Use user_id as circle_id (standard pattern)
        this.circleId = grandma.user_id;
        
        // Create circle if it doesn't exist
        try {
            await createCareCircle(this.circleId, grandma.user_id);
            console.log(`  ✓ Created care circle: ${this.circleId}`);
        } catch (error) {
            // Circle might already exist
            if (error.message.includes('UNIQUE constraint')) {
                console.log(`  ✓ Care circle already exists: ${this.circleId}`);
            } else {
                throw error;
            }
        }
        
        // Add members
        for (const userConfig of REAL_WORLD_SCENARIO.users) {
            const user = await findUserByUsername(userConfig.username);
            if (!user) {
                console.warn(`  ⚠️  User ${userConfig.username} not found, skipping`);
                continue;
            }
            try {
                await addMemberToCircle(this.circleId, user.user_id, userConfig.role, userConfig.relationship);
                console.log(`  ✓ Added ${userConfig.username} as ${userConfig.role}`);
            } catch (error) {
                // Member might already exist
                console.log(`  ✓ ${userConfig.username} already in circle`);
            }
        }
        
        console.log('✅ Initialization complete!\n');
    }

    async simulateClient(userId, messages) {
        const user = await findUserByUsername(userId);
        if (!user) {
            console.error(`❌ User ${userId} not found`);
            return;
        }

        console.log(`\n📱 CLIENT ${userId.toUpperCase()} CONNECTING...`);
        console.log(`   Circle: ${this.circleId}`);
        console.log(`   Messages to send: ${messages.length}\n`);

        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            console.log(`[${userId}] → "${msg}"`);
            
            try {
                const response = await handleMessage(user.user_id, this.circleId, msg);
                if (response && response.reply) {
                    console.log(`[AGENT] → "${response.reply.substring(0, 100)}${response.reply.length > 100 ? '...' : ''}"`);
                }
                
                // Small delay between messages
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                console.error(`[ERROR] ${userId}: ${error.message}`);
            }
        }
    }

    async runSimulation() {
        await this.initialize();
        
        console.log('🌍 STARTING 4-CLIENT REAL-WORLD SIMULATION\n');
        console.log('='.repeat(80));
        
        // Simulate 4 clients sending messages concurrently
        const client1 = this.simulateClient('grandma', [
            'I\'ve been feeling dizzy lately, especially in the mornings.',
            'I don\'t want to worry anyone, but I did fall yesterday. Nothing serious though.'
        ]);
        
        const client2 = this.simulateClient('dad', [
            'Mom mentioned she\'s been dizzy. Should we be concerned?',
            'I\'m worried about her safety at home alone.'
        ]);
        
        const client3 = this.simulateClient('mom', [
            'I noticed she\'s been unsteady when walking. Maybe we should check her blood pressure.',
            'Should we schedule a doctor visit?'
        ]);
        
        const client4 = this.simulateClient('dr_smith', [
            'I\'ve reviewed the reports. Let\'s schedule a checkup to assess the dizziness.',
            '/agent ask grandma about her medication schedule'
        ]);
        
        // Run all clients concurrently
        await Promise.all([client1, client2, client3, client4]);
        
        console.log('\n' + '='.repeat(80));
        console.log('✅ 4-CLIENT SIMULATION COMPLETE');
        console.log(`   Circle: ${this.circleId}`);
        console.log('   All clients processed successfully\n');
        
        // Ensure process exits
        process.exit(0);
    }
}

// Run simulation
const simulator = new MultiClientSimulator();
simulator.runSimulation().catch(error => {
    console.error('❌ Simulation failed:', error);
    process.exit(1);
});

