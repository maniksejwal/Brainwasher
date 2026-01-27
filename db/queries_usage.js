import { getDb } from './connection.js';

/**
 * Log API usage and cost to the database
 */
export async function logApiUsage(provider, model, useCase, promptTokens, completionTokens, totalTokens, costUsd, metadata = {}) {
    const db = await getDb();
    await db.run(
        `INSERT INTO api_usage (
            timestamp, provider, model, use_case, 
            prompt_tokens, completion_tokens, total_tokens, 
            cost_usd, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            Date.now(), provider, model, useCase,
            promptTokens, completionTokens, totalTokens,
            costUsd, JSON.stringify(metadata)
        ]
    );
}

/**
 * Get API usage statistics aggregated by provider and model
 */
export async function getApiUsageStats(timeWindow = '24h') {
    const db = await getDb();
    const now = Date.now();
    let startTime;

    switch (timeWindow) {
        case '24h': startTime = now - 24 * 60 * 60 * 1000; break;
        case '7d': startTime = now - 7 * 24 * 60 * 60 * 1000; break;
        case '30d': startTime = now - 30 * 24 * 60 * 60 * 1000; break;
        default: startTime = 0;
    }

    return db.all(`
        SELECT 
            provider, 
            model, 
            COUNT(*) as request_count,
            SUM(total_tokens) as total_tokens,
            SUM(cost_usd) as total_cost
        FROM api_usage
        WHERE timestamp > ?
        GROUP BY provider, model
        ORDER BY total_cost DESC
    `, [startTime]);
}
