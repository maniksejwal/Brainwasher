import express from 'express';
import fs from 'fs/promises';

const router = express.Router();

// Generate analysis report
router.post('/analyze', async (req, res) => {
    try {
        // Read training log
        const logData = await fs.readFile('./training/training_log.jsonl', 'utf-8');
        const lines = logData.trim().split('\n').filter(line => line);
        const allLogs = lines.map(line => JSON.parse(line));

        // Calculate simple stats
        const totalInteractions = allLogs.length;
        const avgLatency = allLogs.reduce((sum, log) => sum + (log.latency_ms || 0), 0) / totalInteractions;
        const escalations = allLogs.filter(log => log.escalated).length;
        const shares = allLogs.filter(log => log.shared).length;

        res.json({
            success: true,
            total: totalInteractions,
            avgScore: 0, // Would need feedback data
            avgLatency: Math.round(avgLatency),
            escalations,
            shares,
            report: 'Analysis complete'
        });
    } catch (error) {
        console.error('[API] Analysis error:', error.message);
        res.status(500).json({ error: error.message });
    }
});

export default router;
