/**
 * @fileoverview Dialog Graph REST API
 *
 * Endpoints:
 *   GET  /api/dialog-graphs                     — list all graphs
 *   GET  /api/dialog-graphs/:graphId            — get graph with nodes + edges
 *   POST /api/dialog-graphs                     — create / update a graph
 *   GET  /api/dialog-graphs/:graphId/runs       — list simulation runs for a graph
 *   GET  /api/dialog-graphs/runs/:runId/path    — get the step sequence for a run
 *   GET  /api/dialog-graphs/:graphId/compare    — compare baseline vs MCTS run paths
 *   POST /api/dialog-graphs/:graphId/import-sim — import a past simulation run
 */

import express from 'express';
import {
    listDialogGraphs,
    getDialogGraph,
    upsertDialogGraph,
    getDialogGraphRuns,
    getRunPath,
    compareRunPaths,
    importSimulationRunToGraph,
} from '../db/queries_dialog_graphs.js';

const router = express.Router();

// List all graphs (optionally filter by domain)
router.get('/dialog-graphs', async (req, res) => {
    try {
        const { domain } = req.query;
        const graphs = await listDialogGraphs(domain || null);
        res.json({ graphs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get full graph (nodes + edges)
router.get('/dialog-graphs/:graphId', async (req, res) => {
    try {
        const graph = await getDialogGraph(req.params.graphId);
        if (!graph) return res.status(404).json({ error: 'Graph not found' });
        res.json(graph);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create / update a graph
router.post('/dialog-graphs', async (req, res) => {
    try {
        const def = req.body;
        if (!def?.graph_id || !def?.name || !def?.domain) {
            return res.status(400).json({ error: 'graph_id, name, and domain are required' });
        }
        await upsertDialogGraph(def);
        res.status(201).json({ ok: true, graph_id: def.graph_id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update node positions (called by GUI drag-and-drop)
router.patch('/dialog-graphs/:graphId/nodes/:nodeId/position', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const db = await getDb();
        const { x, y } = req.body;
        await db.run(
            'UPDATE dialog_graph_nodes SET position_x = ?, position_y = ? WHERE node_id = ? AND graph_id = ?',
            [x ?? 0, y ?? 0, req.params.nodeId, req.params.graphId]
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Patch node properties (label, type, role, content, notes, etc.)
router.patch('/dialog-graphs/:graphId/nodes/:nodeId', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const db = await getDb();
        const allowed = [
            'label', 'type', 'role', 'criticality',
            'expected_content', 'expert_example', 'expert_notes',
            'required_elements', 'forbidden_elements',
        ];
        const sets = [];
        const vals = [];
        for (const key of allowed) {
            if (key in req.body) {
                sets.push(`${key} = ?`);
                vals.push(Array.isArray(req.body[key]) ? JSON.stringify(req.body[key]) : req.body[key]);
            }
        }
        if (!sets.length) return res.status(400).json({ error: 'No valid fields to update' });
        vals.push(req.params.nodeId, req.params.graphId);
        await db.run(
            `UPDATE dialog_graph_nodes SET ${sets.join(', ')} WHERE node_id = ? AND graph_id = ?`,
            vals
        );
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new node
router.post('/dialog-graphs/:graphId/nodes', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const { randomUUID } = await import('crypto');
        const db = await getDb();
        const { label, type, role, position_x, position_y } = req.body;
        if (!label) return res.status(400).json({ error: 'label required' });
        const nodeId = `n_${randomUUID().replace(/-/g,'').slice(0,10)}`;
        await db.run(
            `INSERT INTO dialog_graph_nodes
             (node_id, graph_id, label, type, role, position_x, position_y)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nodeId, req.params.graphId, label, type || 'user_input', role || 'agent', position_x ?? 0, position_y ?? 0]
        );
        res.status(201).json({ ok: true, node_id: nodeId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete a node (and its edges)
router.delete('/dialog-graphs/:graphId/nodes/:nodeId', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const db = await getDb();
        await db.run('DELETE FROM dialog_graph_edges WHERE (from_node_id = ? OR to_node_id = ?) AND graph_id = ?',
            [req.params.nodeId, req.params.nodeId, req.params.graphId]);
        await db.run('DELETE FROM dialog_graph_nodes WHERE node_id = ? AND graph_id = ?',
            [req.params.nodeId, req.params.graphId]);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create a new edge
router.post('/dialog-graphs/:graphId/edges', async (req, res) => {
    try {
        const { getDb } = await import('../db/connection.js');
        const { randomUUID } = await import('crypto');
        const db = await getDb();
        const { from_node_id, to_node_id, label } = req.body;
        if (!from_node_id || !to_node_id) return res.status(400).json({ error: 'from_node_id and to_node_id required' });
        const edgeId = `e_${randomUUID().replace(/-/g,'').slice(0,10)}`;
        await db.run(
            `INSERT INTO dialog_graph_edges (edge_id, graph_id, from_node_id, to_node_id, label)
             VALUES (?, ?, ?, ?, ?)`,
            [edgeId, req.params.graphId, from_node_id, to_node_id, label || '']
        );
        res.status(201).json({ ok: true, edge_id: edgeId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// List runs for a graph
router.get('/dialog-graphs/:graphId/runs', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const runs = await getDialogGraphRuns(req.params.graphId, limit);
        res.json({ runs });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get the step-by-step path for a run
router.get('/dialog-graphs/runs/:runId/path', async (req, res) => {
    try {
        const steps = await getRunPath(req.params.runId);
        res.json({ steps });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Compare two runs (MCTS vs baseline) against the same graph
router.get('/dialog-graphs/:graphId/compare', async (req, res) => {
    try {
        const { baseline, mcts } = req.query;
        const result = await compareRunPaths(req.params.graphId, baseline || null, mcts || null);
        if (!result) return res.status(404).json({ error: 'Graph not found' });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Import a past simulation run into a graph
router.post('/dialog-graphs/:graphId/import-sim', async (req, res) => {
    try {
        const { simRun } = req.body;
        if (!simRun?.id) return res.status(400).json({ error: 'simRun.id required' });
        const runId = await importSimulationRunToGraph(simRun, req.params.graphId);
        res.status(201).json({ ok: true, run_id: runId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
