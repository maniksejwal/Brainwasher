/**
 * Metrics Collection System
 * 
 * Tracks performance metrics for the multi-agent system.
 * Used for monitoring and identifying areas for improvement.
 */

import { getStorage } from '../../lib/storage/index.js';

class MetricsCollector {
  constructor(metricsPath = 'training/metrics.jsonl') {
    this.metricsPath = metricsPath;
    this.storage = getStorage();
    this.enabled = process.env.METRICS_COLLECTION !== 'disabled';

    // In-memory buffer for batching (flush every 10 metrics or 30 seconds)
    this.buffer = [];
    this.bufferSize = 10;
    this.flushInterval = 30000; // 30 seconds

    this._startPeriodicFlush();
  }

  /**
   * Record a metric event
   */
  async record(metricType, data) {
    if (!this.enabled) return;

    try {
      const metric = {
        timestamp: Date.now(),
        type: metricType,
        ...data
      };

      this.buffer.push(metric);

      // Auto-flush if buffer is full
      if (this.buffer.length >= this.bufferSize) {
        await this.flush();
      }
    } catch (error) {
      console.error('[MetricsCollector] Error recording metric:', error.message);
    }
  }

  /**
   * Specific metric types
   */

  async recordResponseTime(agentType, durationMs, success) {
    await this.record('response_time', {
      agent_type: agentType,
      duration_ms: durationMs,
      success
    });
  }

  async recordEscalation(userId, reason, accepted) {
    await this.record('escalation', {
      user_id: userId,
      reason,
      accepted
    });
  }

  async recordPrivacyViolationAttempt(userId, violationType, blocked) {
    await this.record('privacy_violation', {
      user_id: userId,
      violation_type: violationType,
      blocked
    });
  }

  async recordConflictResolution(circleId, conflictType, resolved) {
    await this.record('conflict_resolution', {
      circle_id: circleId,
      conflict_type: conflictType,
      resolved
    });
  }

  async recordMessageLength(userId, messageLength, responseLength) {
    await this.record('message_length', {
      user_id: userId,
      message_length: messageLength,
      response_length: responseLength
    });
  }

  async recordActionExecution(actionType, success, errorType = null) {
    await this.record('action_execution', {
      action_type: actionType,
      success,
      error_type: errorType
    });
  }

  /**
   * Flush buffer to disk
   */
  async flush() {
    if (this.buffer.length === 0) return;

    try {
      const lines = this.buffer.map(m => JSON.stringify(m)).join('\n') + '\n';
      await this.storage.append(this.metricsPath, lines);
      this.buffer = [];
    } catch (error) {
      console.error('[MetricsCollector] Error flushing metrics:', error.message);
    }
  }

  /**
   * Start periodic flush
   */
  _startPeriodicFlush() {
    setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * Initialize metrics file
   */
  async initialize() {
    try {
      if (!(await this.storage.exists(this.metricsPath))) {
        await this.storage.write(this.metricsPath, '');
        console.log('[MetricsCollector] Initialized metrics file at:', this.metricsPath);
      }
    } catch (error) {
      console.error('[MetricsCollector] Error initializing:', error.message);
    }
  }

  /**
   * Read metrics from file
   */
  async readMetrics(filter = null) {
    try {
      const content = await this.storage.read(this.metricsPath);
      const lines = content.trim().split('\n').filter(line => line);
      const metrics = lines.map(line => JSON.parse(line));

      if (filter) {
        return metrics.filter(filter);
      }
      return metrics;
    } catch (error) {
      console.error('[MetricsCollector] Error reading metrics:', error.message);
      return [];
    }
  }

  /**
   * Get aggregated statistics
   */
  async getAggregatedStats(timeWindowMs = 3600000) { // Default: 1 hour
    const now = Date.now();
    const metrics = await this.readMetrics(m => m.timestamp > now - timeWindowMs);

    const stats = {
      time_window_ms: timeWindowMs,
      total_events: metrics.length,
      by_type: {}
    };

    // Group by type
    for (const metric of metrics) {
      if (!stats.by_type[metric.type]) {
        stats.by_type[metric.type] = {
          count: 0,
          data: []
        };
      }
      stats.by_type[metric.type].count++;
      stats.by_type[metric.type].data.push(metric);
    }

    // Calculate specific stats
    if (stats.by_type.response_time) {
      const responseTimes = stats.by_type.response_time.data;
      stats.response_time_stats = {
        average_ms: responseTimes.reduce((sum, m) => sum + m.duration_ms, 0) / responseTimes.length,
        max_ms: Math.max(...responseTimes.map(m => m.duration_ms)),
        min_ms: Math.min(...responseTimes.map(m => m.duration_ms)),
        success_rate: responseTimes.filter(m => m.success).length / responseTimes.length
      };
    }

    if (stats.by_type.escalation) {
      const escalations = stats.by_type.escalation.data;
      stats.escalation_stats = {
        total: escalations.length,
        accepted_rate: escalations.filter(e => e.accepted).length / escalations.length
      };
    }

    if (stats.by_type.privacy_violation) {
      const violations = stats.by_type.privacy_violation.data;
      stats.privacy_stats = {
        total_attempts: violations.length,
        blocked_rate: violations.filter(v => v.blocked).length / violations.length
      };
    }

    return stats;
  }
}

// Singleton instance
const metrics = new MetricsCollector();
metrics.initialize();

export default metrics;

