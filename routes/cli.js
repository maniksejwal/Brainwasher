import express from 'express';
import { spawn } from 'child_process';
import { sanitizeCLIOutput } from '../lib/logger.js';

const router = express.Router();

/**
 * Generic CLI command executor with streaming support
 */
function executeCLICommand(command, args, res, timeoutMs = 300000) {
    const childProcess = spawn('node', [command, ...args], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const ensureHeaders = () => {
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/json');
        }
    };

    const timeout = setTimeout(() => {
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: 'Command timeout' }) + '\n');
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: false,
                    code: -1,
                    stdout: '',
                    stderr: 'Command timeout'
                }
            }) + '\n');
            res.end();
        }
        if (childProcess && !childProcess.killed) {
            childProcess.kill();
        }
    }, timeoutMs);

    let stdout = '';
    let stderr = '';

    childProcess.stdout.on('data', (data) => {
        const chunk = sanitizeCLIOutput(data.toString());
        stdout += chunk;
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stdout', data: chunk }) + '\n');
        }
    });

    childProcess.stderr.on('data', (data) => {
        const chunk = sanitizeCLIOutput(data.toString());
        stderr += chunk;
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: chunk }) + '\n');
        }
    });

    childProcess.on('close', (code) => {
        clearTimeout(timeout);
        ensureHeaders();
        console.log(`[CLI close ${command}] code=${code} stdoutLen=${stdout.length} stderrLen=${stderr.length}`);
        if (!res.writableEnded) {
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: code === 0,
                    code,
                    stdout,
                    stderr
                }
            }) + '\n');
            res.end();
        }
    });

    childProcess.on('error', (error) => {
        clearTimeout(timeout);
        ensureHeaders();
        if (!res.writableEnded) {
            res.write(JSON.stringify({ type: 'stderr', data: error.message }) + '\n');
            res.write(JSON.stringify({
                type: 'result',
                data: {
                    success: false,
                    code: -1,
                    stdout,
                    stderr: stderr ? `${stderr}\n${error.message}` : error.message
                }
            }) + '\n');
            res.end();
        }
    });
}

// Run simulation CLI
router.post('/run-simulation', async (req, res) => {
    try {
        const { scenario, turns, skipFeedback } = req.body;
        const args = [];
        if (scenario) args.push('--scenario', scenario);
        if (turns) args.push('--turns', String(turns));
        const shouldSkip = skipFeedback !== false;
        if (shouldSkip) {
            args.push('--skip-feedback');
        } else {
            args.push('--with-feedback');
        }
        args.push('--from-dashboard');

        executeCLICommand('cli/run_simulation.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Train CLI
router.post('/train', async (req, res) => {
    try {
        const { command = 'run', prompts, scenarios } = req.body;
        const args = [command];
        if (prompts) args.push('--prompts', prompts);
        if (scenarios) args.push('--scenarios', String(scenarios));

        executeCLICommand('cli/train.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Analyze CLI
router.post('/analyze', async (req, res) => {
    try {
        const { command = 'all' } = req.body;
        executeCLICommand('cli/analyze.js', [command], res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Generate HTML Report
router.post('/generate-report', async (req, res) => {
    try {
        // Run the generation script
        executeCLICommand('training/analysis/generate_simulation_report.js', [], res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// World simulation CLI
router.post('/world-simulation', async (req, res) => {
    try {
        const { scenario, skipFeedback } = req.body;
        const args = [];
        if (scenario) args.push('--scenario', scenario);
        const shouldSkip = skipFeedback !== false;
        if (shouldSkip) {
            args.push('--skip-feedback');
        } else {
            args.push('--with-feedback');
        }

        executeCLICommand('cli/world_simulation_cli.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

router.post('/prompts', async (req, res) => {
    try {
        const { command, version, compare } = req.body;
        const args = [command];
        if (version) args.push(version);
        if (compare) args.push('--compare');

        executeCLICommand('cli/prompts.js', args, res);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Export simulation runs from the simulation DB into dialog graphs.
 *
 * POST /api/cli/export-dialog-graphs
 * Body: { graphId: string, limit?: number, domain?: string }
 *
 * Reads the most recent simulation runs from the simulation DB,
 * maps each conversation to a dialog graph run, and imports it.
 * Returns the list of created run IDs.
 */
router.post('/export-dialog-graphs', async (req, res) => {
    try {
        const { graphId, limit = 10, scenarioId } = req.body;
        if (!graphId) {
            return res.status(400).json({ error: 'graphId required' });
        }

        // Import simulation DB and dialog graph queries
        const { open } = await import('sqlite');
        const sqlite3Module = await import('sqlite3');
        const sqlite3 = sqlite3Module.default;
        const { importSimulationRunToGraph, getDialogGraph } = await import('../db/queries_dialog_graphs.js');
        const config = await import('../config.js');

        // Verify target graph exists
        const graph = await getDialogGraph(graphId);
        if (!graph) {
            return res.status(404).json({ error: `Graph '${graphId}' not found` });
        }

        const simDbPath = config.default.getDbPath?.('simulation') || './data/dbs/simulation.db';
        let simDb;
        try {
            simDb = await open({ filename: simDbPath, driver: sqlite3.Database });
        } catch {
            return res.status(404).json({ error: 'Simulation database not found. Run at least one simulation first.' });
        }

        // Pull recent conversation messages grouped by circle_id (= one sim run)
        let query = `
            SELECT m.circle_id, m.user_id, m.role, m.message, m.timestamp
            FROM messages m
            ORDER BY m.circle_id, m.timestamp ASC
        `;
        const rows = await simDb.all(query);
        await simDb.close();

        // Group by circle_id
        const groups = {};
        for (const row of rows) {
            (groups[row.circle_id] = groups[row.circle_id] || []).push(row);
        }

        const circleIds = Object.keys(groups).slice(0, limit);
        const importedRunIds = [];

        for (const circleId of circleIds) {
            const messages = groups[circleId].map((r, i) => ({
                sender:  r.role,
                content: r.message,
                turn:    i,
            }));
            const simRun = {
                id:        `sim_${circleId}`,
                circleId,
                scenarioId: scenarioId || null,
                startedAt: messages[0] ? groups[circleId][0].timestamp : Date.now(),
                outcome:   'complete',
                messages,
            };
            const runId = await importSimulationRunToGraph(simRun, graphId);
            importedRunIds.push(runId);
        }

        res.json({
            ok: true,
            graph_id: graphId,
            imported: importedRunIds.length,
            run_ids:  importedRunIds,
        });
    } catch (error) {
        console.error('[CLI] export-dialog-graphs error:', error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
