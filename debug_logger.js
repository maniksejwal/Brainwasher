
import logger from './training/core/logger.js';
import path from 'path';

console.log('Current CWD:', process.cwd());
console.log('Logger path:', logger.logPath);
console.log('Logger enabled:', logger.enabled);

(async () => {
    try {
        console.log('Attempting to log...');
        await logger.logInteraction({
            conversationId: 'test_debug_123',
            userId: 'debug_user',
            message: 'test message',
            agentResponse: 'test response',
            intent: 'DEBUG_TEST',
            future_plan: { step: 'test' },
            latencyMs: 100
        });
        console.log('Log call completed.');
    } catch (err) {
        console.error('Log failed:', err);
    }
})();
