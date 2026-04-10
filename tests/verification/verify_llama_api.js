/**
 * @fileoverview Verification script for Llama 4 API Integration
 */

import { makeApiCall } from '../agents/api_client.js';
import config from '../config.js';

async function testLlamaIntegration() {
    console.log('🦙 Testing Llama 4 API Integration...\n');

    if (!config.LLAMA_API_URL) {
        console.error('❌ Error: LLAMA_API_URL is not defined in config.');
        return;
    }

    console.log(`Endpoint: ${config.LLAMA_API_URL}`);
    console.log('Sending test prompt ("Hello, are you functional?")...\n');

    try {
        // We can force a specific provider if we modify getNextProvider logic or 
        // rely on the random round-robin if enabled. 
        // For verification, it's best to hack config.USE_ONLY_OPENAI temporarily or 
        // mock the other providers failure to ensure Llama is picked, 
        // OR add a forceProvider param to makeApiCall (which we didn't do yet).

        // Alternatively, we can directly call the internal function if we exported it, 
        // but since we didn't export `callLlama`, we'll try to rely on the generic call 
        // or temporarily disable others.

        // Let's rely on the fact that if we have a special model name 'llama4' mapping,
        // (which isn't implemented in model selection, but let's see).

        // Actually, makeApiCall uses getNextProvider which round-robins. 
        // To strictly test Llama, let's look at the logs to see if it was used.

        // BETTER: Manually invoke a fetch to be 100% sure we are hitting the endpoint first.

        console.log(`Checking: ${config.LLAMA_API_URL}`);

        const payload = {
            prompt: "Explain diabetes",
            max_new_tokens: 512,
            temperature: 0.7
        };

        const response = await fetch(config.LLAMA_API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            console.log(`✅ SUCCESS! Found valid endpoint: ${config.LLAMA_API_URL}`);
            const data = await response.json();
            console.log('Response:', data);
        } else {
            console.log(`❌ Failed: ${response.status} ${response.statusText}`);
            const text = await response.text();
            console.log('   Body:', text);
            return;
        }

        console.log('\n--- Now testing via makeApiCall (might pick other providers) ---');
        const agentResponse = await makeApiCall("Test message for Llama 4", [], false, 0.7, 50);
        console.log('Agent Response:', agentResponse);
        console.log('Metadata:', {
            modelUsed: agentResponse.modelUsed,
            provider: agentResponse.modelProvider
        });

    } catch (error) {
        console.error('❌ Test Exception:', error);
    }
}

testLlamaIntegration().catch(console.error);
