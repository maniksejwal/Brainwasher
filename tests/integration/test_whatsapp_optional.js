/**
 * @fileoverview Test that system works WITHOUT WhatsApp configured
 * Ensures WhatsApp integration is truly optional
 */

import assert from 'assert';

console.log('\n🧪 Testing: System works without WhatsApp configured\n');

async function testWhatsAppOptional() {
    console.log('Test 1: AIsensyClient doesn\'t crash...');
    
    const { default: aisensyClient } = await import('../integrations/whatsapp/aisensyClient.js');
    
    console.log(`  ℹ️  WhatsApp ${aisensyClient.enabled ? 'enabled' : 'disabled'}`);
    console.log('  ✓ Client initialized without crashing');

    console.log('\nTest 2: sendMessage returns safely...');
    
    const result = await aisensyClient.sendMessage('+1234567890', 'Test');
    
    // Should return result object (success or failure)
    assert(result, 'Should return result object');
    assert(typeof result.success === 'boolean', 'Should have success field');
    
    if (result.success) {
        console.log('  ✓ Sent successfully (WhatsApp is configured)');
    } else {
        console.log(`  ✓ Failed gracefully (reason: ${result.reason || 'unknown'})`);
        console.log('  ✓ No crash - safe for development');
    }

    console.log('\nTest 3: sendToWhatsApp handles missing user...');
    
    const { sendToWhatsApp } = await import('../integrations/whatsapp/webhookHandler.js');
    
    const sendResult = await sendToWhatsApp('fake_user_id', 'Test message');
    
    assert.strictEqual(sendResult.success, false, 'Should fail gracefully');
    console.log('  ✓ Handles missing user without crashing');

    console.log('\nTest 4: Webhook validates payload...');
    
    const { handleWhatsAppWebhook } = await import('../integrations/whatsapp/webhookHandler.js');
    
    // Mock request/response
    const mockReq = { body: {} }; // Invalid payload
    const mockRes = {
        status: (code) => ({
            json: (data) => {
                assert.strictEqual(code, 400, 'Should return 400 for invalid payload');
                console.log('  ✓ Validates payload before processing');
                return data;
            }
        })
    };
    
    await handleWhatsAppWebhook(mockReq, mockRes);

    console.log('\n✅ All tests passed!');
    console.log('✅ System is safe to run with OR without WhatsApp configured');
    console.log('✅ No crashes, graceful degradation\n');
}

testWhatsAppOptional().catch(error => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
});

