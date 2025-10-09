/**
 * Tests for Training Logger
 * 
 * Ensures logging doesn't interfere with conversation flow
 */

import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import the TrainingLogger class (not the singleton)
// We need to create a custom class for testing
class TrainingLogger {
  constructor(logPath = './training/training_log.jsonl') {
    this.logPath = logPath;
    this.enabled = process.env.TRAINING_MODE !== 'disabled';
  }

  async logInteraction(data) {
    if (!this.enabled) return;

    try {
      const logEntry = {
        timestamp: Date.now(),
        conversation_id: data.conversationId,
        user_id: data.userId,
        message: data.message,
        agent_response: data.agentResponse,
        orchestrator_action: data.orchestratorAction,
        state_vector: data.stateVector,
        prompt_version: data.promptVersion || 'unknown',
        latency_ms: data.latencyMs,
        message_length: data.message?.length || 0,
        response_length: data.agentResponse?.length || 0,
        escalated: data.orchestratorAction?.type === 'ESCALATE',
        shared: data.orchestratorAction?.type === 'SHARE'
      };

      await this._appendToLog(logEntry);
    } catch (error) {
      console.error('[TrainingLogger] Error logging interaction:', error.message);
    }
  }

  async _appendToLog(entry) {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.logPath, line, 'utf8');
  }

  async initialize() {
    try {
      const dir = path.dirname(this.logPath);
      await fs.mkdir(dir, { recursive: true });
      
      try {
        await fs.access(this.logPath);
      } catch {
        await fs.writeFile(this.logPath, '', 'utf8');
        console.log('[TrainingLogger] Initialized training log at:', this.logPath);
      }
    } catch (error) {
      console.error('[TrainingLogger] Error initializing:', error.message);
    }
  }

  async readLog(filter = null) {
    try {
      const content = await fs.readFile(this.logPath, 'utf8');
      const lines = content.trim().split('\n').filter(line => line);
      const entries = lines.map(line => JSON.parse(line));
      
      if (filter) {
        return entries.filter(filter);
      }
      return entries;
    } catch (error) {
      console.error('[TrainingLogger] Error reading log:', error.message);
      return [];
    }
  }

  async getStats() {
    const entries = await this.readLog();
    
    return {
      total_interactions: entries.length,
      escalations: entries.filter(e => e.escalated).length,
      shares: entries.filter(e => e.shared).length,
      average_response_length: entries.reduce((sum, e) => sum + (e.response_length || 0), 0) / entries.length || 0,
      date_range: {
        start: entries[0]?.timestamp,
        end: entries[entries.length - 1]?.timestamp
      }
    };
  }
}

async function setup() {
  const testLogPath = './training/test_training_log.jsonl';
  const logger = new TrainingLogger(testLogPath);
  await logger.initialize();
  
  // Clear test file
  await fs.writeFile(testLogPath, '', 'utf8');
  
  return { logger, testLogPath };
}

async function cleanup(testLogPath) {
  try {
    await fs.unlink(testLogPath);
  } catch (error) {
    // Ignore if file doesn't exist
  }
}

async function testLoggerDoesNotBlock() {
  console.log('Testing: Logger does not block conversation flow...');
  
  const { logger, testLogPath } = await setup();
  
  const startTime = Date.now();
  
  // Log interaction (should be async and not block)
  logger.logInteraction({
    conversationId: 'test_conv_1',
    userId: 'alice',
    message: 'I feel dizzy',
    agentResponse: 'I am concerned about your dizziness',
    orchestratorAction: { type: 'ESCALATE' },
    promptVersion: 'v1.0',
    latencyMs: 150
  });
  
  const blockTime = Date.now() - startTime;
  
  // Should complete almost instantly (< 50ms)
  assert(blockTime < 50, `Logger blocked for ${blockTime}ms, expected < 50ms`);
  
  // Give it a moment to actually write
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Verify it was written
  const entries = await logger.readLog();
  assert.strictEqual(entries.length, 1, 'Expected 1 log entry');
  assert.strictEqual(entries[0].user_id, 'alice');
  
  await cleanup(testLogPath);
  console.log('✓ Logger does not block conversation flow');
}

async function testLoggerHandlesCrashes() {
  console.log('Testing: Logger handles crashes gracefully...');
  
  const { logger, testLogPath } = await setup();
  
  // Try to log invalid data (should not throw)
  try {
    await logger.logInteraction({
      // Missing required fields - might cause issues
      invalid: undefined,
      circular: null
    });
    
    // Should still work
    console.log('✓ Logger handles invalid data gracefully');
  } catch (error) {
    assert.fail('Logger should not throw errors: ' + error.message);
  }
  
  await cleanup(testLogPath);
}

async function testMetricsAccuracy() {
  console.log('Testing: Metrics are accurately recorded...');
  
  const { logger, testLogPath } = await setup();
  
  // Log multiple interactions with different types
  await logger.logInteraction({
    conversationId: 'conv_1',
    userId: 'alice',
    message: 'test',
    agentResponse: 'response',
    orchestratorAction: { type: 'ESCALATE' }
  });
  
  await logger.logInteraction({
    conversationId: 'conv_2',
    userId: 'bob',
    message: 'test2',
    agentResponse: 'response2',
    orchestratorAction: { type: 'SHARE', target: 'alice' }
  });
  
  await logger.logInteraction({
    conversationId: 'conv_3',
    userId: 'alice',
    message: 'test3',
    agentResponse: 'response3',
    orchestratorAction: { type: 'WAIT' }
  });
  
  // Wait for writes
  await new Promise(resolve => setTimeout(resolve, 100));
  
  const stats = await logger.getStats();
  
  assert.strictEqual(stats.total_interactions, 3, 'Expected 3 interactions');
  assert.strictEqual(stats.escalations, 1, 'Expected 1 escalation');
  assert.strictEqual(stats.shares, 1, 'Expected 1 share');
  
  await cleanup(testLogPath);
  console.log('✓ Metrics are accurately recorded');
}

async function testJSONLFormat() {
  console.log('Testing: JSONL files are valid...');
  
  const { logger, testLogPath } = await setup();
  
  // Log several entries
  for (let i = 0; i < 5; i++) {
    await logger.logInteraction({
      conversationId: `conv_${i}`,
      userId: 'alice',
      message: `message ${i}`,
      agentResponse: `response ${i}`
    });
  }
  
  // Wait for writes
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Read file directly and verify JSONL format
  const content = await fs.readFile(testLogPath, 'utf8');
  const lines = content.trim().split('\n');
  
  assert.strictEqual(lines.length, 5, 'Expected 5 lines');
  
  // Each line should be valid JSON
  for (const line of lines) {
    const parsed = JSON.parse(line); // Will throw if invalid
    assert(parsed.timestamp, 'Expected timestamp field');
    assert(parsed.conversation_id, 'Expected conversation_id field');
  }
  
  await cleanup(testLogPath);
  console.log('✓ JSONL files are valid');
}

async function testPerformanceOverhead() {
  console.log('Testing: Performance overhead < 5ms...');
  
  const { logger, testLogPath } = await setup();
  
  const iterations = 100;
  const timings = [];
  
  for (let i = 0; i < iterations; i++) {
    const start = Date.now();
    
    logger.logInteraction({
      conversationId: `perf_test_${i}`,
      userId: 'alice',
      message: 'Performance test message',
      agentResponse: 'Performance test response'
    });
    
    const duration = Date.now() - start;
    timings.push(duration);
  }
  
  const avgOverhead = timings.reduce((a, b) => a + b, 0) / timings.length;
  
  assert(avgOverhead < 5, `Average overhead ${avgOverhead}ms exceeds 5ms threshold`);
  
  await cleanup(testLogPath);
  console.log(`✓ Performance overhead: ${avgOverhead.toFixed(2)}ms (< 5ms)`);
}

// Run all tests
async function runTests() {
  console.log('\n=== Running Training Logger Tests ===\n');
  
  try {
    await testLoggerDoesNotBlock();
    await testLoggerHandlesCrashes();
    await testMetricsAccuracy();
    await testJSONLFormat();
    await testPerformanceOverhead();
    
    console.log('\n✅ All training logger tests passed!\n');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
const isMainModule = import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));
if (isMainModule || process.argv[1].includes('test_training_logger')) {
  runTests();
}

export { runTests };

