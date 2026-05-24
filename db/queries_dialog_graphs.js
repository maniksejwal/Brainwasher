/**
 * @fileoverview Dialog Graph DB queries
 *
 * Dialog graphs are directed acyclic graphs (DAGs) of conversation states and
 * transitions. They serve two purposes:
 *
 *   1. Supervised training: expert-validated paths through clinical/business
 *      conversations that can be used as ground-truth for model evaluation.
 *
 *   2. MCTS comparison: the graph captures both the "ideal path" (expert) and
 *      the "observed path" (what the agents actually did in a simulation run),
 *      enabling side-by-side comparison.
 *
 * Schema (added to main DB via addDialogGraphTables()):
 *
 *   dialog_graphs          — graph metadata (domain, description, source)
 *   dialog_graph_nodes     — conversation states (user/agent/branch/terminal)
 *   dialog_graph_edges     — valid transitions with weights and trigger text
 *   dialog_graph_runs      — one row per simulation run linked to a graph
 *   dialog_graph_run_steps — the actual path taken in a run (node sequence)
 */

import { getDb } from './connection.js';

// ── Schema ────────────────────────────────────────────────────────────────────

export async function addDialogGraphTables() {
    const db = await getDb();
    await db.exec(`
        CREATE TABLE IF NOT EXISTS dialog_graphs (
            graph_id    TEXT PRIMARY KEY,
            domain      TEXT NOT NULL,          -- 'medical' | 'business' | 'negotiation'
            name        TEXT NOT NULL,
            description TEXT,
            source      TEXT NOT NULL,          -- 'expert' | 'simulation' | 'hybrid'
            expert_validated_by TEXT,
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL,
            metadata    TEXT                    -- JSON (version, tags, scenario_id)
        );

        CREATE TABLE IF NOT EXISTS dialog_graph_nodes (
            node_id     TEXT NOT NULL,
            graph_id    TEXT NOT NULL,
            type        TEXT NOT NULL,          -- 'user_input' | 'agent_response' | 'branch' | 'success' | 'failure'
            label       TEXT NOT NULL,          -- short human name
            role        TEXT,                   -- 'patient' | 'doctor' | 'rcm_agent' | 'companion'
            expected_content TEXT,
            expert_example   TEXT,
            required_elements TEXT,             -- JSON array
            forbidden_elements TEXT,            -- JSON array
            criticality TEXT DEFAULT 'medium',  -- 'low' | 'medium' | 'high' | 'critical'
            physio_context TEXT,                -- JSON: stress_threshold, hrv_range, etc.
            expert_notes TEXT,
            position_x  REAL DEFAULT 0,         -- GUI layout hint (x coord)
            position_y  REAL DEFAULT 0,         -- GUI layout hint (y coord)
            PRIMARY KEY (node_id, graph_id),
            FOREIGN KEY (graph_id) REFERENCES dialog_graphs(graph_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS dialog_graph_edges (
            edge_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            graph_id    TEXT NOT NULL,
            from_node   TEXT NOT NULL,
            to_node     TEXT NOT NULL,
            trigger_text     TEXT,              -- what the user/agent says to fire this edge
            probability      REAL DEFAULT 1.0,  -- expert-estimated likelihood
            quality_metric   TEXT,              -- JSON: scoring criteria
            expert_validation TEXT,             -- 'good' | 'acceptable' | 'bad'
            physio_condition TEXT,              -- JSON: stress_max, hrv_min, etc.
            FOREIGN KEY (graph_id) REFERENCES dialog_graphs(graph_id) ON DELETE CASCADE
        );

        -- One row per simulation run that was mapped to a graph
        CREATE TABLE IF NOT EXISTS dialog_graph_runs (
            run_id      TEXT PRIMARY KEY,
            graph_id    TEXT NOT NULL,
            simulation_run_id TEXT,             -- links to simulator.js runId
            scenario_id TEXT,
            circle_id   TEXT,
            started_at  INTEGER NOT NULL,
            ended_at    INTEGER,
            outcome     TEXT,                   -- 'success' | 'failure' | 'incomplete'
            mcts_used   INTEGER DEFAULT 0,      -- 0 = baseline, 1 = MCTS active
            metadata    TEXT,                   -- JSON (physio summary, turns, etc.)
            FOREIGN KEY (graph_id) REFERENCES dialog_graphs(graph_id)
        );

        -- The actual sequence of nodes visited in a run (the observed path)
        CREATE TABLE IF NOT EXISTS dialog_graph_run_steps (
            step_id     INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id      TEXT NOT NULL,
            graph_id    TEXT NOT NULL,
            node_id     TEXT NOT NULL,
            step_index  INTEGER NOT NULL,       -- turn number in conversation
            actual_text TEXT,                   -- what was actually said
            score       REAL,                   -- quality score for this step
            physio_snapshot TEXT,               -- JSON PhysiologicalState at this step
            diverged_from_expert INTEGER DEFAULT 0, -- 1 if off the expert path
            FOREIGN KEY (run_id) REFERENCES dialog_graph_runs(run_id)
        );

        CREATE INDEX IF NOT EXISTS idx_dg_nodes_graph  ON dialog_graph_nodes(graph_id);
        CREATE INDEX IF NOT EXISTS idx_dg_edges_graph  ON dialog_graph_edges(graph_id);
        CREATE INDEX IF NOT EXISTS idx_dg_edges_from   ON dialog_graph_edges(from_node, graph_id);
        CREATE INDEX IF NOT EXISTS idx_dgr_steps_run   ON dialog_graph_run_steps(run_id);
        CREATE INDEX IF NOT EXISTS idx_dgr_graph       ON dialog_graph_runs(graph_id);
    `);
}

// ── Write operations ──────────────────────────────────────────────────────────

/**
 * Upsert a full dialog graph (graph + nodes + edges) from a plain JS object.
 *
 * @param {object} graphDef  — shape: { graph_id, domain, name, description,
 *   source, expert_validated_by, metadata, nodes: [...], edges: [...] }
 */
export async function upsertDialogGraph(graphDef) {
    const db = await getDb();
    const now = Date.now();

    await db.run(`
        INSERT INTO dialog_graphs
            (graph_id, domain, name, description, source, expert_validated_by, created_at, updated_at, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(graph_id) DO UPDATE SET
            name=excluded.name, description=excluded.description,
            source=excluded.source, updated_at=excluded.updated_at,
            metadata=excluded.metadata
    `, [
        graphDef.graph_id,
        graphDef.domain,
        graphDef.name,
        graphDef.description || '',
        graphDef.source || 'expert',
        graphDef.expert_validated_by || null,
        now, now,
        JSON.stringify(graphDef.metadata || {}),
    ]);

    // Upsert nodes
    for (const node of (graphDef.nodes || [])) {
        await db.run(`
            INSERT INTO dialog_graph_nodes
                (node_id, graph_id, type, label, role, expected_content, expert_example,
                 required_elements, forbidden_elements, criticality, physio_context,
                 expert_notes, position_x, position_y)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(node_id, graph_id) DO UPDATE SET
                label=excluded.label, expected_content=excluded.expected_content,
                expert_notes=excluded.expert_notes, physio_context=excluded.physio_context
        `, [
            node.node_id, graphDef.graph_id,
            node.type, node.label, node.role || null,
            node.expected_content || null, node.expert_example || null,
            JSON.stringify(node.required_elements || []),
            JSON.stringify(node.forbidden_elements || []),
            node.criticality || 'medium',
            JSON.stringify(node.physio_context || {}),
            node.expert_notes || null,
            node.position_x ?? 0, node.position_y ?? 0,
        ]);
    }

    // Replace edges (simpler than upsert for DAG edges)
    if (graphDef.edges?.length) {
        await db.run('DELETE FROM dialog_graph_edges WHERE graph_id = ?', [graphDef.graph_id]);
        for (const edge of graphDef.edges) {
            await db.run(`
                INSERT INTO dialog_graph_edges
                    (graph_id, from_node, to_node, trigger_text, probability, quality_metric,
                     expert_validation, physio_condition)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `, [
                graphDef.graph_id,
                edge.from_node, edge.to_node,
                edge.trigger_text || null,
                edge.probability ?? 1.0,
                JSON.stringify(edge.quality_metric || {}),
                edge.expert_validation || 'good',
                JSON.stringify(edge.physio_condition || {}),
            ]);
        }
    }
}

/**
 * Record a dialog graph run (maps a simulation run to a graph).
 */
export async function createDialogGraphRun(runDef) {
    const db = await getDb();
    await db.run(`
        INSERT INTO dialog_graph_runs
            (run_id, graph_id, simulation_run_id, scenario_id, circle_id,
             started_at, outcome, mcts_used, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        runDef.run_id, runDef.graph_id,
        runDef.simulation_run_id || null,
        runDef.scenario_id || null,
        runDef.circle_id || null,
        runDef.started_at || Date.now(),
        runDef.outcome || 'incomplete',
        runDef.mcts_used ? 1 : 0,
        JSON.stringify(runDef.metadata || {}),
    ]);
}

export async function appendRunStep(runId, graphId, step) {
    const db = await getDb();
    await db.run(`
        INSERT INTO dialog_graph_run_steps
            (run_id, graph_id, node_id, step_index, actual_text, score,
             physio_snapshot, diverged_from_expert)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        runId, graphId, step.node_id, step.step_index,
        step.actual_text || null, step.score ?? null,
        step.physio_snapshot ? JSON.stringify(step.physio_snapshot) : null,
        step.diverged_from_expert ? 1 : 0,
    ]);
}

export async function finalizeDialogGraphRun(runId, outcome, endedAt) {
    const db = await getDb();
    await db.run(
        'UPDATE dialog_graph_runs SET outcome = ?, ended_at = ? WHERE run_id = ?',
        [outcome, endedAt || Date.now(), runId]
    );
}

// ── Read operations ───────────────────────────────────────────────────────────

export async function listDialogGraphs(domain) {
    const db = await getDb();
    if (domain) {
        return db.all('SELECT * FROM dialog_graphs WHERE domain = ? ORDER BY updated_at DESC', [domain]);
    }
    return db.all('SELECT * FROM dialog_graphs ORDER BY updated_at DESC');
}

export async function getDialogGraph(graphId) {
    const db = await getDb();
    const graph = await db.get('SELECT * FROM dialog_graphs WHERE graph_id = ?', [graphId]);
    if (!graph) return null;
    graph.nodes = await db.all('SELECT * FROM dialog_graph_nodes WHERE graph_id = ?', [graphId]);
    graph.edges = await db.all('SELECT * FROM dialog_graph_edges WHERE graph_id = ?', [graphId]);
    // Parse JSON fields
    for (const node of graph.nodes) {
        node.required_elements  = JSON.parse(node.required_elements  || '[]');
        node.forbidden_elements = JSON.parse(node.forbidden_elements || '[]');
        node.physio_context     = JSON.parse(node.physio_context     || '{}');
    }
    for (const edge of graph.edges) {
        edge.quality_metric    = JSON.parse(edge.quality_metric    || '{}');
        edge.physio_condition  = JSON.parse(edge.physio_condition  || '{}');
    }
    graph.metadata = JSON.parse(graph.metadata || '{}');
    return graph;
}

export async function getDialogGraphRuns(graphId, limit = 20) {
    const db = await getDb();
    return db.all(
        'SELECT * FROM dialog_graph_runs WHERE graph_id = ? ORDER BY started_at DESC LIMIT ?',
        [graphId, limit]
    );
}

export async function getRunPath(runId) {
    const db = await getDb();
    return db.all(
        'SELECT * FROM dialog_graph_run_steps WHERE run_id = ? ORDER BY step_index ASC',
        [runId]
    );
}

/**
 * Compare two runs against the same graph: returns the expert path (ideal)
 * and both observed paths for MCTS vs baseline comparison.
 *
 * Returns: { graph, expert_path, baseline_run, mcts_run }
 */
export async function compareRunPaths(graphId, baselineRunId, mctsRunId) {
    const db = await getDb();
    const graph = await getDialogGraph(graphId);
    if (!graph) return null;

    const baselinePath = baselineRunId
        ? await db.all('SELECT * FROM dialog_graph_run_steps WHERE run_id = ? ORDER BY step_index ASC', [baselineRunId])
        : [];
    const mctsPath = mctsRunId
        ? await db.all('SELECT * FROM dialog_graph_run_steps WHERE run_id = ? ORDER BY step_index ASC', [mctsRunId])
        : [];

    // Build the expert (ideal) path: edges where expert_validation = 'good', traversal order
    const expertPath = graph.nodes.filter(n => n.type !== 'failure');

    return { graph, expert_path: expertPath, baseline_path: baselinePath, mcts_path: mctsPath };
}

/**
 * Populate dialog graph from a past simulation run stored in the simulation DB.
 * Extracts conversation messages and maps them to graph nodes by matching
 * role + turn sequence.
 *
 * @param {object} simRun  — { id, messages: [{sender, content, turn}] }
 * @param {string} graphId — target dialog graph to attach the run to
 */
export async function importSimulationRunToGraph(simRun, graphId) {
    const runId = `sim_import_${simRun.id}_${Date.now()}`;

    await createDialogGraphRun({
        run_id: runId,
        graph_id: graphId,
        simulation_run_id: simRun.id,
        scenario_id: simRun.scenarioId || null,
        started_at: simRun.startedAt || Date.now(),
        outcome: simRun.outcome || 'incomplete',
        mcts_used: false,
    });

    for (let i = 0; i < (simRun.messages || []).length; i++) {
        const msg = simRun.messages[i];
        await appendRunStep(runId, graphId, {
            node_id: msg.nodeId || `auto_${i}`,
            step_index: i,
            actual_text: msg.content,
            score: msg.score ?? null,
            physio_snapshot: msg.physioSnapshot || null,
            diverged_from_expert: false,
        });
    }

    return runId;
}
