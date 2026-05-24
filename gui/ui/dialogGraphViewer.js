/**
 * @fileoverview Dialog Graph Viewer + Editor
 *
 * Renders dialog graphs as interactive node-link diagrams in the browser.
 * Supports:
 *   - Viewing the expert path (gold standard)
 *   - Overlaying observed simulation run paths
 *   - Side-by-side comparison: baseline vs MCTS run
 *   - Drag-to-reposition nodes (persisted via PATCH /api/dialog-graphs/:id/nodes/:nid/position)
 *   - Exporting a graph definition as JSON
 *
 * Depends only on the browser's native Canvas API — no third-party graph library.
 * Uses a simple force-directed layout seeded from stored position_x / position_y.
 */

const NODE_COLORS = {
    user_input:     '#3b82f6',  // blue
    agent_response: '#10b981',  // green
    branch:         '#f59e0b',  // amber
    success:        '#22c55e',  // bright green
    failure:        '#ef4444',  // red
};

const PATH_COLORS = {
    expert:   '#6366f1',   // indigo
    baseline: '#f97316',   // orange
    mcts:     '#14b8a6',   // teal
};

export class DialogGraphViewer {
    /**
     * @param {HTMLElement} container
     * @param {object}      options
     * @param {string}      options.graphId         — graph to load on init
     * @param {boolean}     [options.editable=true] — enable drag+node edit
     */
    constructor(container, options = {}) {
        this.container  = container;
        this.graphId    = options.graphId || null;
        this.editable   = options.editable !== false;
        this.graph      = null;         // current graph data
        this.runPaths   = {};           // { baseline: [...], mcts: [...] }
        this.selectedNode = null;
        this._dragging  = null;
        this._canvas    = null;
        this._ctx       = null;
        this._scale     = 1.0;
        this._offset    = { x: 0, y: 0 };

        this._build();
        if (this.graphId) this.loadGraph(this.graphId);
    }

    // ── DOM construction ───────────────────────────────────────────────────────

    _build() {
        this.container.innerHTML = `
            <div class="dg-viewer" style="display:flex;flex-direction:column;height:100%;font-family:system-ui,sans-serif">

                <!-- Search bar -->
                <div class="dg-search-bar" style="display:flex;gap:6px;padding:6px 8px;background:#0f172a;border-bottom:1px solid #334155;align-items:center;flex-wrap:wrap">
                    <input id="dg-search-input" placeholder="Search nodes, personas, scenarios, domains…"
                        style="flex:1;min-width:200px;padding:4px 8px;border-radius:4px;background:#1e293b;
                               color:#e2e8f0;border:1px solid #475569;font-size:12px"/>
                    <select id="dg-filter-domain" class="dg-select">
                        <option value="">All domains</option>
                        <option value="clinical">Clinical</option>
                        <option value="deaddiction">Deaddiction</option>
                        <option value="flooding">Flooding</option>
                        <option value="negotiation">Negotiation</option>
                    </select>
                    <select id="dg-filter-type" class="dg-select">
                        <option value="">All types</option>
                        <option value="user_input">User input</option>
                        <option value="agent_response">Agent response</option>
                        <option value="branch">Branch</option>
                        <option value="success">Success</option>
                        <option value="failure">Failure</option>
                    </select>
                    <button id="dg-btn-search" class="dg-btn">Search</button>
                    <button id="dg-btn-search-clear" class="dg-btn" style="color:#f87171">Clear</button>
                </div>

                <!-- Main toolbar -->
                <div class="dg-toolbar" style="display:flex;gap:8px;padding:8px;background:#1e293b;align-items:center;flex-wrap:wrap">
                    <select id="dg-graph-select" class="dg-select" style="min-width:200px">
                        <option value="">-- select graph --</option>
                    </select>
                    <button id="dg-btn-load"       class="dg-btn">Load</button>
                    <button id="dg-btn-new-graph"  class="dg-btn dg-btn-primary">+ New Graph</button>
                    <button id="dg-btn-add-node"   class="dg-btn" title="Click canvas after to place node">+ Node</button>
                    <button id="dg-btn-add-edge"   class="dg-btn" title="Click source then target node">+ Edge</button>
                    <button id="dg-btn-del-node"   class="dg-btn dg-btn-danger" title="Click node to delete">Del Node</button>
                    <button id="dg-btn-compare"    class="dg-btn">Compare Runs</button>
                    <button id="dg-btn-export"     class="dg-btn">Export JSON</button>
                    <button id="dg-btn-import"     class="dg-btn">Import JSON</button>
                    <button id="dg-btn-reset"      class="dg-btn">Reset Layout</button>
                    <span id="dg-edit-mode-label" style="font-size:11px;color:#f59e0b;display:none">● EDIT MODE</span>
                    <span class="dg-legend" style="margin-left:auto;display:flex;gap:8px;font-size:11px;color:#94a3b8">
                        <span><span style="color:${PATH_COLORS.expert}">■</span> Expert</span>
                        <span><span style="color:${PATH_COLORS.baseline}">■</span> Baseline</span>
                        <span><span style="color:${PATH_COLORS.mcts}">■</span> MCTS</span>
                    </span>
                </div>

                <!-- Search results panel (hidden until search) -->
                <div id="dg-search-results" style="display:none;max-height:160px;overflow-y:auto;background:#1e293b;
                    border-bottom:1px solid #334155;padding:6px 8px;font-size:11px;color:#e2e8f0"></div>

                <!-- Main canvas + sidebar -->
                <div style="display:flex;flex:1;overflow:hidden">
                    <canvas id="dg-canvas" style="flex:1;background:#0f172a;cursor:grab"></canvas>
                    <div id="dg-sidebar" style="width:300px;background:#1e293b;overflow-y:auto;padding:12px;font-size:12px;color:#e2e8f0;display:none"></div>
                </div>
                <div id="dg-status" style="padding:4px 8px;background:#1e293b;font-size:11px;color:#64748b"></div>
            </div>
            <input type="file" id="dg-file-input" accept=".json" style="display:none"/>
        `;
        this._injectStyles();

        this._canvas = this.container.querySelector('#dg-canvas');
        this._ctx    = this._canvas.getContext('2d');
        this._editMode  = null;   // null | 'add_node' | 'add_edge' | 'del_node'
        this._edgeFrom  = null;   // source node when adding an edge
        this._searchHits = [];    // highlighted node ids from last search
        this._allGraphs  = [];    // full graph list from server for search

        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this._canvas.parentElement);

        // Toolbar events
        this.container.querySelector('#dg-btn-load')       .addEventListener('click', () => this._onLoad());
        this.container.querySelector('#dg-btn-compare')    .addEventListener('click', () => this._onCompare());
        this.container.querySelector('#dg-btn-export')     .addEventListener('click', () => this._onExport());
        this.container.querySelector('#dg-btn-import')     .addEventListener('click', () => this.container.querySelector('#dg-file-input').click());
        this.container.querySelector('#dg-btn-reset')      .addEventListener('click', () => this._resetLayout());
        this.container.querySelector('#dg-btn-new-graph')  .addEventListener('click', () => this._onNewGraph());
        this.container.querySelector('#dg-btn-add-node')   .addEventListener('click', () => this._setEditMode('add_node'));
        this.container.querySelector('#dg-btn-add-edge')   .addEventListener('click', () => this._setEditMode('add_edge'));
        this.container.querySelector('#dg-btn-del-node')   .addEventListener('click', () => this._setEditMode('del_node'));
        this.container.querySelector('#dg-file-input')     .addEventListener('change', e => this._onImport(e));

        // Search events
        this.container.querySelector('#dg-btn-search')     .addEventListener('click', () => this._onSearch());
        this.container.querySelector('#dg-btn-search-clear').addEventListener('click', () => this._clearSearch());
        this.container.querySelector('#dg-search-input')   .addEventListener('keydown', e => { if (e.key === 'Enter') this._onSearch(); });

        // Canvas events
        this._canvas.addEventListener('mousedown', e => this._onMouseDown(e));
        this._canvas.addEventListener('mousemove', e => this._onMouseMove(e));
        this._canvas.addEventListener('mouseup',   e => this._onMouseUp(e));
        this._canvas.addEventListener('wheel',     e => this._onWheel(e), { passive: false });
        this._canvas.addEventListener('dblclick',  e => this._onDblClick(e));

        this._populateGraphList();
    }

    _injectStyles() {
        if (document.getElementById('dg-viewer-styles')) return;
        const style = document.createElement('style');
        style.id = 'dg-viewer-styles';
        style.textContent = `
            .dg-btn {
                padding: 4px 10px; border-radius: 4px; cursor: pointer;
                background: #334155; color: #e2e8f0; border: 1px solid #475569;
                font-size: 12px;
            }
            .dg-btn:hover { background: #475569; }
            .dg-btn-primary { background: #1d4ed8; border-color: #2563eb; }
            .dg-btn-primary:hover { background: #2563eb; }
            .dg-btn-danger  { background: #7f1d1d; border-color: #991b1b; }
            .dg-btn-danger:hover  { background: #991b1b; }
            .dg-btn-active  { outline: 2px solid #f59e0b; }
            .dg-select {
                padding: 4px 8px; border-radius: 4px; background: #334155;
                color: #e2e8f0; border: 1px solid #475569; font-size: 12px;
            }
            .dg-search-hit  { background: #3d2c00; }
            .dg-search-row  { padding: 4px 6px; cursor: pointer; border-radius: 3px; }
            .dg-search-row:hover { background: #334155; }
        `;
        document.head.appendChild(style);
    }

    // ── Data loading ───────────────────────────────────────────────────────────

    async _populateGraphList() {
        try {
            const res  = await fetch('/api/dialog-graphs');
            const data = await res.json();
            this._allGraphs = data.graphs || [];
            const sel  = this.container.querySelector('#dg-graph-select');
            for (const g of this._allGraphs) {
                const opt = document.createElement('option');
                opt.value       = g.graph_id;
                opt.textContent = `[${g.domain || 'general'}] ${g.name}`;
                opt.dataset.domain   = g.domain || '';
                opt.dataset.persona  = g.persona || '';
                opt.dataset.scenario = g.scenario_id || '';
                sel.appendChild(opt);
            }
            if (this.graphId) sel.value = this.graphId;
        } catch (e) {
            this._status('Failed to load graph list: ' + e.message);
        }
    }

    async loadGraph(graphId) {
        this._status('Loading graph...');
        try {
            const res  = await fetch(`/api/dialog-graphs/${graphId}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            this.graph    = await res.json();
            this.graphId  = graphId;
            this.runPaths = {};
            this._autoLayout();
            this._render();
            this._status(`Loaded: ${this.graph.name} (${this.graph.nodes.length} nodes, ${this.graph.edges.length} edges)`);
        } catch (e) {
            this._status('Error: ' + e.message);
        }
    }

    async loadCompare(baselineRunId, mctsRunId) {
        if (!this.graphId) return;
        try {
            const url = `/api/dialog-graphs/${this.graphId}/compare?baseline=${baselineRunId || ''}&mcts=${mctsRunId || ''}`;
            const res = await fetch(url);
            const data = await res.json();
            this.runPaths = {
                baseline: data.baseline_path || [],
                mcts:     data.mcts_path     || [],
            };
            this._render();
            this._status(`Comparing: baseline (${this.runPaths.baseline.length} steps) vs MCTS (${this.runPaths.mcts.length} steps)`);
        } catch (e) {
            this._status('Compare error: ' + e.message);
        }
    }

    // ── Layout ──────────────────────────────────────────────────────────────────

    _autoLayout() {
        if (!this.graph?.nodes?.length) return;
        const W = this._canvas.width  || 800;
        const H = this._canvas.height || 600;

        // Use stored positions if all non-zero; otherwise compute a simple DAG layout
        const allZero = this.graph.nodes.every(n => n.position_x === 0 && n.position_y === 0);

        if (allZero) {
            // Topological layering: assign columns by reachability depth
            const adj = {};
            const inDeg = {};
            for (const n of this.graph.nodes) { adj[n.node_id] = []; inDeg[n.node_id] = 0; }
            for (const e of this.graph.edges) {
                adj[e.from_node]?.push(e.to_node);
                if (inDeg[e.to_node] !== undefined) inDeg[e.to_node]++;
            }
            const depth = {};
            const queue = Object.keys(inDeg).filter(k => inDeg[k] === 0);
            queue.forEach(k => { depth[k] = 0; });
            while (queue.length) {
                const cur = queue.shift();
                for (const next of (adj[cur] || [])) {
                    depth[next] = Math.max(depth[next] ?? 0, (depth[cur] ?? 0) + 1);
                    queue.push(next);
                }
            }
            // Group by depth layer
            const layers = {};
            for (const n of this.graph.nodes) {
                const d = depth[n.node_id] ?? 0;
                (layers[d] = layers[d] || []).push(n);
            }
            const maxLayer = Math.max(...Object.keys(layers).map(Number));
            const xStep = W / (maxLayer + 2);
            for (const [layer, nodes] of Object.entries(layers)) {
                const yStep = H / (nodes.length + 1);
                nodes.forEach((n, i) => {
                    n.position_x = xStep * (Number(layer) + 1);
                    n.position_y = yStep * (i + 1);
                });
            }
        }

        // Centre the graph
        this._offset = { x: 0, y: 0 };
        this._scale  = 1.0;
    }

    _resetLayout() {
        if (!this.graph) return;
        this.graph.nodes.forEach(n => { n.position_x = 0; n.position_y = 0; });
        this._autoLayout();
        this._render();
    }

    // ── Rendering ──────────────────────────────────────────────────────────────

    _resize() {
        const parent = this._canvas.parentElement;
        this._canvas.width  = parent.clientWidth;
        this._canvas.height = parent.clientHeight;
        this._render();
    }

    _render() {
        const ctx = this._ctx;
        const W = this._canvas.width;
        const H = this._canvas.height;
        ctx.clearRect(0, 0, W, H);
        if (!this.graph) return;

        ctx.save();
        ctx.translate(this._offset.x, this._offset.y);
        ctx.scale(this._scale, this._scale);

        // Build node position map
        const pos = {};
        for (const n of this.graph.nodes) pos[n.node_id] = { x: n.position_x, y: n.position_y };

        // Draw edges
        for (const e of this.graph.edges) {
            const from = pos[e.from_node];
            const to   = pos[e.to_node];
            if (!from || !to) continue;
            ctx.beginPath();
            ctx.moveTo(from.x, from.y);
            ctx.lineTo(to.x, to.y);
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            this._arrowHead(ctx, from, to, '#334155');
        }

        // Draw path overlays
        this._drawPath(ctx, pos, this.runPaths.baseline, PATH_COLORS.baseline, 3, -3);
        this._drawPath(ctx, pos, this.runPaths.mcts,     PATH_COLORS.mcts,     3, +3);

        // Draw nodes
        for (const n of this.graph.nodes) {
            const { x, y } = pos[n.node_id] || { x: 0, y: 0 };
            const r        = 22;
            const color    = NODE_COLORS[n.type] || '#64748b';
            const isSel    = this.selectedNode?.node_id === n.node_id;
            const isHit    = this._searchHits?.includes(n.node_id);

            ctx.beginPath();
            ctx.arc(x, y, r + (isSel ? 4 : 0), 0, Math.PI * 2);
            ctx.fillStyle   = color + (isSel ? 'ff' : 'cc');
            ctx.strokeStyle = isHit ? '#f59e0b' : (isSel ? '#fff' : color);
            ctx.lineWidth   = isHit ? 3 : (isSel ? 3 : 1);
            ctx.fill();
            ctx.stroke();

            // Search-hit glow
            if (isHit) {
                ctx.beginPath();
                ctx.arc(x, y, r + 7, 0, Math.PI * 2);
                ctx.strokeStyle = '#f59e0b44';
                ctx.lineWidth   = 5;
                ctx.stroke();
            }

            // Label
            ctx.fillStyle    = '#fff';
            ctx.font         = '10px system-ui';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            const label = (n.label || n.node_id).substring(0, 14);
            ctx.fillText(label, x, y);
        }

        ctx.restore();
    }

    _drawPath(ctx, pos, steps, color, width, offset) {
        if (!steps?.length) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth   = width;
        ctx.globalAlpha = 0.7;
        for (let i = 0; i < steps.length - 1; i++) {
            const from = pos[steps[i].node_id];
            const to   = pos[steps[i + 1].node_id];
            if (!from || !to) continue;
            ctx.moveTo(from.x + offset, from.y + offset);
            ctx.lineTo(to.x + offset,   to.y + offset);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
    }

    _arrowHead(ctx, from, to, color) {
        const ang  = Math.atan2(to.y - from.y, to.x - from.x);
        const len  = 8;
        const tip  = { x: to.x - 24 * Math.cos(ang), y: to.y - 24 * Math.sin(ang) };
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - len * Math.cos(ang - 0.4), tip.y - len * Math.sin(ang - 0.4));
        ctx.lineTo(tip.x - len * Math.cos(ang + 0.4), tip.y - len * Math.sin(ang + 0.4));
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
    }

    // ── Interaction ────────────────────────────────────────────────────────────

    _canvasPoint(e) {
        const rect = this._canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this._offset.x) / this._scale,
            y: (e.clientY - rect.top  - this._offset.y) / this._scale,
        };
    }

    _nodeAt(pt) {
        if (!this.graph) return null;
        for (const n of this.graph.nodes) {
            const dx = pt.x - n.position_x;
            const dy = pt.y - n.position_y;
            if (Math.sqrt(dx * dx + dy * dy) < 26) return n;
        }
        return null;
    }

    _onMouseDown(e) {
        const pt   = this._canvasPoint(e);
        const node = this._nodeAt(pt);

        if (this._editMode) {
            this._editModeClick(pt, node);
            return;
        }

        if (node && this.editable) {
            this._dragging = { node, startX: e.clientX, startY: e.clientY, origX: node.position_x, origY: node.position_y };
            this._canvas.style.cursor = 'grabbing';
        } else {
            this._panStart = { mx: e.clientX, my: e.clientY, ox: this._offset.x, oy: this._offset.y };
            this._canvas.style.cursor = 'grabbing';
        }
    }

    _onMouseMove(e) {
        if (this._dragging) {
            const dx = (e.clientX - this._dragging.startX) / this._scale;
            const dy = (e.clientY - this._dragging.startY) / this._scale;
            this._dragging.node.position_x = this._dragging.origX + dx;
            this._dragging.node.position_y = this._dragging.origY + dy;
            this._render();
        } else if (this._panStart) {
            this._offset.x = this._panStart.ox + (e.clientX - this._panStart.mx);
            this._offset.y = this._panStart.oy + (e.clientY - this._panStart.my);
            this._render();
        }
    }

    _onMouseUp(e) {
        if (this._dragging && this.editable) {
            const n = this._dragging.node;
            fetch(`/api/dialog-graphs/${this.graphId}/nodes/${n.node_id}/position`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ x: n.position_x, y: n.position_y }),
            }).catch(() => {});
        }
        this._dragging  = null;
        this._panStart  = null;
        this._canvas.style.cursor = 'grab';
    }

    _onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.1 : 0.9;
        this._scale = Math.max(0.2, Math.min(3.0, this._scale * factor));
        this._render();
    }

    _onDblClick(e) {
        const pt   = this._canvasPoint(e);
        const node = this._nodeAt(pt);
        this.selectedNode = node;
        this._render();
        this._showSidebar(node);
    }

    _showSidebar(node) {
        const sidebar = this.container.querySelector('#dg-sidebar');
        if (!node) { sidebar.style.display = 'none'; return; }
        sidebar.style.display = 'block';

        const esc = s => String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const field = (key, label, value, multiline = false) =>
            multiline
                ? `<tr><td colspan="2" style="padding:4px 0">
                    <div style="color:#94a3b8;margin-bottom:2px">${label}</div>
                    <textarea data-field="${key}" rows="3"
                        style="width:100%;box-sizing:border-box;background:#0f172a;color:#e2e8f0;
                               border:1px solid #334155;border-radius:3px;padding:3px;font-size:11px;resize:vertical"
                    >${esc(value)}</textarea></td></tr>`
                : `<tr>
                    <td style="padding:3px 6px 3px 0;color:#94a3b8;white-space:nowrap;vertical-align:top">${label}</td>
                    <td style="padding:3px 0">
                        <input data-field="${key}" value="${esc(value)}"
                            style="width:100%;background:#0f172a;color:#e2e8f0;border:1px solid #334155;
                                   border-radius:3px;padding:2px 4px;font-size:11px"/>
                    </td></tr>`;

        sidebar.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <h3 style="margin:0;color:#e2e8f0;font-size:13px">${esc(node.label)}</h3>
                <button id="dg-sidebar-close" class="dg-btn" style="padding:2px 6px">✕</button>
            </div>
            <table style="width:100%;border-collapse:collapse">
                ${field('label',            'Label',          node.label)}
                ${field('type',             'Type',           node.type)}
                ${field('role',             'Role',           node.role || '')}
                ${field('criticality',      'Criticality',    node.criticality || '')}
                ${field('expected_content', 'Expected',       node.expected_content || '', true)}
                ${field('expert_example',   'Expert example', node.expert_example   || '', true)}
                ${field('expert_notes',     'Notes',          node.expert_notes     || '', true)}
                ${field('required_elements','Required (CSV)', (node.required_elements || []).join(', '))}
                ${field('forbidden_elements','Forbidden (CSV)',(node.forbidden_elements || []).join(', '))}
            </table>
            <div style="margin-top:8px;display:flex;gap:6px">
                <button id="dg-sidebar-save"   class="dg-btn dg-btn-primary" style="flex:1">Save</button>
                <button id="dg-sidebar-delete" class="dg-btn dg-btn-danger">Delete</button>
            </div>
            <div id="dg-sidebar-msg" style="margin-top:4px;font-size:11px;color:#10b981;display:none"></div>
        `;

        sidebar.querySelector('#dg-sidebar-close').addEventListener('click', () => {
            sidebar.style.display = 'none';
            this.selectedNode = null;
            this._render();
        });

        sidebar.querySelector('#dg-sidebar-save').addEventListener('click', async () => {
            const patch = {};
            sidebar.querySelectorAll('[data-field]').forEach(el => {
                const key = el.dataset.field;
                const val = el.value.trim();
                if (key === 'required_elements' || key === 'forbidden_elements') {
                    patch[key] = val ? val.split(',').map(s => s.trim()) : [];
                } else {
                    patch[key] = val;
                }
            });
            // Update local node
            Object.assign(node, patch);
            this._render();

            try {
                const res = await fetch(`/api/dialog-graphs/${this.graphId}/nodes/${node.node_id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(patch),
                });
                const msg = sidebar.querySelector('#dg-sidebar-msg');
                msg.style.display = 'block';
                if (res.ok) {
                    msg.textContent = 'Saved.';
                    msg.style.color = '#10b981';
                    // Update header
                    sidebar.querySelector('h3').textContent = node.label;
                } else {
                    msg.textContent = 'Save failed: ' + res.status;
                    msg.style.color = '#f87171';
                }
                setTimeout(() => { msg.style.display = 'none'; }, 2000);
            } catch (err) {
                this._status('Save error: ' + err.message);
            }
        });

        sidebar.querySelector('#dg-sidebar-delete').addEventListener('click', () => {
            if (!confirm(`Delete node "${node.label}"?`)) return;
            fetch(`/api/dialog-graphs/${this.graphId}/nodes/${node.node_id}`, { method: 'DELETE' })
                .then(() => {
                    sidebar.style.display = 'none';
                    this.selectedNode = null;
                    this.loadGraph(this.graphId);
                });
        });
    }

    // ── Search ─────────────────────────────────────────────────────────────────

    _onSearch() {
        const query  = (this.container.querySelector('#dg-search-input').value || '').toLowerCase().trim();
        const domain = this.container.querySelector('#dg-filter-domain').value;
        const type   = this.container.querySelector('#dg-filter-type').value;
        const panel  = this.container.querySelector('#dg-search-results');

        if (!query && !domain && !type) { this._clearSearch(); return; }

        // Search graphs list
        const graphHits = this._allGraphs.filter(g => {
            if (domain && g.domain !== domain) return false;
            const text = `${g.name} ${g.domain} ${g.persona || ''} ${g.scenario_id || ''} ${g.description || ''}`.toLowerCase();
            return !query || text.includes(query);
        });

        // Search nodes in currently loaded graph
        this._searchHits = [];
        const nodeHits = [];
        if (this.graph?.nodes) {
            for (const n of this.graph.nodes) {
                if (type && n.type !== type) continue;
                const text = `${n.label} ${n.type} ${n.role || ''} ${n.expected_content || ''} ${n.expert_example || ''} ${n.expert_notes || ''}`.toLowerCase();
                if (!query || text.includes(query)) {
                    this._searchHits.push(n.node_id);
                    nodeHits.push(n);
                }
            }
        }

        this._render();

        // Render results panel
        let html = '';
        if (graphHits.length) {
            html += `<div style="color:#94a3b8;margin-bottom:4px">Graphs (${graphHits.length})</div>`;
            for (const g of graphHits.slice(0, 10)) {
                html += `<div class="dg-search-row" data-graph-id="${g.graph_id}">
                    <span style="color:#f59e0b">[${g.domain || '—'}]</span>
                    <span style="color:#e2e8f0">${g.name}</span>
                    ${g.persona ? `<span style="color:#94a3b8"> · ${g.persona}</span>` : ''}
                </div>`;
            }
        }
        if (nodeHits.length) {
            html += `<div style="color:#94a3b8;margin:4px 0">Nodes in current graph (${nodeHits.length})</div>`;
            for (const n of nodeHits.slice(0, 20)) {
                html += `<div class="dg-search-row" data-node-id="${n.node_id}">
                    <span style="color:${NODE_COLORS[n.type] || '#aaa'}">[${n.type}]</span>
                    <span style="color:#e2e8f0"> ${n.label}</span>
                    ${n.role ? `<span style="color:#94a3b8"> · ${n.role}</span>` : ''}
                </div>`;
            }
        }
        if (!graphHits.length && !nodeHits.length) {
            html = `<div style="color:#94a3b8">No results for "${query}"</div>`;
        }

        panel.innerHTML = html;
        panel.style.display = 'block';

        // Click handlers in results
        panel.querySelectorAll('[data-graph-id]').forEach(el =>
            el.addEventListener('click', () => {
                const sel = this.container.querySelector('#dg-graph-select');
                sel.value = el.dataset.graphId;
                this.loadGraph(el.dataset.graphId);
                this._clearSearch();
            })
        );
        panel.querySelectorAll('[data-node-id]').forEach(el =>
            el.addEventListener('click', () => {
                const n = this.graph?.nodes.find(x => x.node_id === el.dataset.nodeId);
                if (n) { this.selectedNode = n; this._render(); this._showSidebar(n); }
            })
        );
    }

    _clearSearch() {
        this.container.querySelector('#dg-search-input').value = '';
        this.container.querySelector('#dg-filter-domain').value = '';
        this.container.querySelector('#dg-filter-type').value   = '';
        this.container.querySelector('#dg-search-results').style.display = 'none';
        this._searchHits = [];
        this._render();
    }

    // ── Edit mode ──────────────────────────────────────────────────────────────

    _setEditMode(mode) {
        this._editMode = this._editMode === mode ? null : mode;
        this._edgeFrom = null;
        const label = this.container.querySelector('#dg-edit-mode-label');
        const modes = { add_node: 'ADD NODE — click canvas', add_edge: 'ADD EDGE — click source', del_node: 'DELETE NODE — click node' };
        if (this._editMode) {
            label.textContent = '● ' + modes[this._editMode];
            label.style.display = 'inline';
            this._canvas.style.cursor = 'crosshair';
        } else {
            label.style.display = 'none';
            this._canvas.style.cursor = 'grab';
        }
        ['add_node','add_edge','del_node'].forEach(m => {
            const btn = this.container.querySelector(`#dg-btn-${m.replace('_','-')}`);
            if (btn) btn.classList.toggle('dg-btn-active', this._editMode === m);
        });
    }

    _editModeClick(pt, node) {
        if (!this.graphId) return;

        if (this._editMode === 'del_node') {
            if (!node) return;
            if (!confirm(`Delete node "${node.label}"?`)) return;
            fetch(`/api/dialog-graphs/${this.graphId}/nodes/${node.node_id}`, { method: 'DELETE' })
                .then(() => { this.loadGraph(this.graphId); this._setEditMode(null); });
            return;
        }

        if (this._editMode === 'add_node') {
            const label = prompt('Node label:');
            if (!label) return;
            const type  = prompt('Node type (user_input / agent_response / branch / success / failure):', 'user_input');
            const role  = prompt('Role (patient / agent / caregiver / clinician):', 'agent');
            fetch(`/api/dialog-graphs/${this.graphId}/nodes`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ label, type: type || 'user_input', role: role || 'agent', position_x: pt.x, position_y: pt.y }),
            }).then(() => this.loadGraph(this.graphId));
            this._setEditMode(null);
            return;
        }

        if (this._editMode === 'add_edge') {
            if (!node) return;
            if (!this._edgeFrom) {
                this._edgeFrom = node;
                this._status(`Edge from "${node.label}" — now click target node`);
                return;
            }
            if (this._edgeFrom.node_id === node.node_id) { this._edgeFrom = null; return; }
            const label = prompt('Edge label (optional):') || '';
            fetch(`/api/dialog-graphs/${this.graphId}/edges`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ from_node_id: this._edgeFrom.node_id, to_node_id: node.node_id, label }),
            }).then(() => this.loadGraph(this.graphId));
            this._edgeFrom = null;
            this._setEditMode(null);
        }
    }

    // ── New graph / import ─────────────────────────────────────────────────────

    async _onNewGraph() {
        const id   = prompt('Graph ID (URL-safe string):');
        if (!id) return;
        const name   = prompt('Graph name:')   || id;
        const domain = prompt('Domain (clinical / deaddiction / flooding / negotiation):', 'clinical') || 'clinical';
        const desc   = prompt('Description (optional):') || '';
        const res = await fetch('/api/dialog-graphs', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graph_id: id, name, domain, description: desc, nodes: [], edges: [] }),
        });
        if (res.ok) {
            await this._populateGraphList();
            this.loadGraph(id);
        } else {
            this._status('Failed to create graph: ' + (await res.text()));
        }
    }

    _onImport(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async e => {
            try {
                const def = JSON.parse(e.target.result);
                const res = await fetch('/api/dialog-graphs', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(def),
                });
                if (res.ok) {
                    await this._populateGraphList();
                    this.loadGraph(def.graph_id);
                } else {
                    this._status('Import failed: ' + (await res.text()));
                }
            } catch (err) {
                this._status('Import error: ' + err.message);
            }
        };
        reader.readAsText(file);
        event.target.value = '';
    }

    _onLoad() {
        const sel = this.container.querySelector('#dg-graph-select');
        if (sel.value) this.loadGraph(sel.value);
    }

    _onCompare() {
        const baseline = prompt('Baseline run ID:');
        const mcts     = prompt('MCTS run ID (or blank for none):');
        if (baseline) this.loadCompare(baseline, mcts || null);
    }

    _onExport() {
        if (!this.graph) return;
        const blob = new Blob([JSON.stringify(this.graph, null, 2)], { type: 'application/json' });
        const a    = document.createElement('a');
        a.href     = URL.createObjectURL(blob);
        a.download = `${this.graph.graph_id}.json`;
        a.click();
    }

    _status(msg) {
        const el = this.container.querySelector('#dg-status');
        if (el) el.textContent = msg;
    }
}

/**
 * Mount the dialog graph viewer into a container element.
 * Called from the main GUI navigation or simulation dashboard.
 *
 * @param {string} containerId   — DOM element ID to mount into
 * @param {string} [graphId]     — pre-select a graph on load
 */
export function mountDialogGraphViewer(containerId, graphId) {
    const container = document.getElementById(containerId);
    if (!container) {
        console.warn(`[DialogGraphViewer] Container #${containerId} not found`);
        return null;
    }
    return new DialogGraphViewer(container, { graphId });
}
