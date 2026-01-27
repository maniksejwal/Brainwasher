/**
 * Training Data Logger
 * 
 * Passively observes and records conversations for training purposes.
 * Designed to be non-blocking and fault-tolerant - if logging fails,
 * the conversation continues unaffected.
 */

import fs from 'fs/promises';
import path from 'path';
import { privacyGuard } from '../../security/privacy_guard.js';

export class TrainingLogger {
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
      // SCRUB PII: Clone and scrub data before logging to ensure privacy
      const safeData = privacyGuard.scrubObject(JSON.parse(JSON.stringify(data)));

      const logEntry = {
        timestamp: Date.now(),
        conversation_id: safeData.conversationId,
        user_id: safeData.userId,
        turn: safeData.turn || null, // Add turn number for precise mapping
        message: safeData.message, // User message
        message_length: safeData.message?.length || 0,
        agent_response: safeData.agentResponse || '',
        response_length: safeData.agentResponse?.length || 0,
        latency_ms: safeData.latencyMs || 0,

        // Context
        state_vector: safeData.stateVector ? JSON.stringify(safeData.stateVector) : null,
        orchestrator_action: safeData.orchestratorAction ? JSON.stringify(safeData.orchestratorAction) : null,
        model_used: safeData.modelUsed || 'unknown',
        prompt_version: safeData.promptVersion || 'unknown',
        system_used: safeData.systemUsed || 'unified',

        // Agentic/RL Fields
        role: safeData.role || null,
        intent: safeData.intent || null,
        future_plan: safeData.future_plan ? JSON.stringify(safeData.future_plan) : null,
        reasoning: safeData.reasoning || null, // Chain of Thought
        outcome_label: safeData.outcomeLabel || null, // Positive/Negative signal
        filter_reason: safeData.filterReason || null
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

