/**
 * Training Data Logger
 * 
 * Passively observes and records conversations for training purposes.
 * Designed to be non-blocking and fault-tolerant - if logging fails,
 * the conversation continues unaffected.
 */

import fs from 'fs/promises';
import path from 'path';

class TrainingLogger {
  constructor(logPath = './training/training_log.jsonl') {
    this.logPath = logPath;
    this.enabled = process.env.TRAINING_MODE !== 'disabled';
  }

  /**
   * Log a complete interaction (message + response + decision)
   * Fire-and-forget: errors are logged but don't block main flow
   */
  async logInteraction(data) {
    if (!this.enabled) return;

    try {
      const logEntry = {
        timestamp: Date.now(),
        conversation_id: data.conversationId,
        user_id: data.userId,
        turn: data.turn || null, // Add turn number for precise mapping
        message: data.message,
        agent_response: data.agentResponse,
        orchestrator_action: data.orchestratorAction,
        state_vector: data.stateVector,
        prompt_version: data.promptVersion || 'unknown',
        system_used: data.systemUsed || 'unified', // Track Companion vs unified
        latency_ms: data.latencyMs,
        // Metadata for analysis
        message_length: data.message?.length || 0,
        response_length: data.agentResponse?.length || 0,
        escalated: data.orchestratorAction?.type === 'ESCALATE',
        shared: data.orchestratorAction?.type === 'SHARE',
        // Model Tracking
        model_used: data.modelUsed || 'unknown',
        model_provider: data.modelProvider || 'unknown',
        // User Role (for scenario grouping)
        role: data.role || null,
        // Agentic Communication Fields
        intent: data.intent || null,
        future_plan: data.future_plan ? JSON.stringify(data.future_plan) : null,
        outcome_label: data.outcomeLabel || null, // 'positive', 'negative', or null
        filter_reason: data.filterReason || null
      };

      await this._appendToLog(logEntry);
    } catch (error) {
      // Fail silently - don't break conversation flow
      console.error('[TrainingLogger] Error logging interaction:', error.message);
    }
  }

  /**
   * Log an orchestrator decision (for reward tracking)
   */
  async logDecision(data) {
    if (!this.enabled) return;

    try {
      const logEntry = {
        timestamp: Date.now(),
        type: 'decision',
        conversation_id: data.conversationId,
        action: data.action,
        state_vector: data.stateVector,
        reasoning: data.reasoning,
        alternatives_considered: data.alternatives
      };

      await this._appendToLog(logEntry);
    } catch (error) {
      console.error('[TrainingLogger] Error logging decision:', error.message);
    }
  }

  /**
   * Log reward/outcome (for RL training)
   */
  async logReward(data) {
    if (!this.enabled) return;

    try {
      const logEntry = {
        timestamp: Date.now(),
        type: 'reward',
        conversation_id: data.conversationId,
        action_id: data.actionId,
        reward_type: data.rewardType, // 'escalation_success', 'privacy_violation', etc.
        reward_value: data.rewardValue,
        context: data.context
      };

      await this._appendToLog(logEntry);
    } catch (error) {
      console.error('[TrainingLogger] Error logging reward:', error.message);
    }
  }

  /**
   * Append entry to JSONL file
   */
  async _appendToLog(entry) {
    const line = JSON.stringify(entry) + '\n';
    await fs.appendFile(this.logPath, line, 'utf8');
  }

  /**
   * Initialize log file if it doesn't exist
   */
  async initialize() {
    try {
      const dir = path.dirname(this.logPath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists, create if not
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

  /**
   * Read log entries (for analysis)
   */
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

  /**
   * Get statistics about logged data
   */
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

// Singleton instance
const logger = new TrainingLogger();
logger.initialize();

export default logger;

