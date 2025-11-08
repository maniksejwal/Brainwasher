/**
 * @fileoverview Network Visualization for World Simulations
 * Uses D3.js to visualize multi-care circle relationships, companions, and message flow
 */

export class NetworkVisualization {
    constructor(containerId) {
        this.containerId = containerId;
        this.svg = null;
        this.simulation = null;
        this.nodes = [];
        this.edges = [];
        this.circles = [];
        this.showLogs = true;
        this.showPrompts = true;
        this.showHardware = true;
        this.width = 1200;
        this.height = 600;
        this.nodeSelection = null;
        this.circleSelection = null;
        this.nodeIndex = new Map();
    }

    /**
     * Initialize the visualization
     */
    init() {
        const container = document.getElementById(this.containerId);
        if (!container) {
            console.error(`[NetworkViz] Container ${this.containerId} not found`);
            return;
        }

        // Clear existing content
        container.innerHTML = '';

        // Create SVG
        this.svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height);

        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.svg.select('g').attr('transform', event.transform);
            });

        this.svg.call(zoom);

        // Create main group for zooming
        const g = this.svg.append('g');

        // Store reference to group
        this.g = g;
    }

    /**
     * Update visualization with new data
     * @param {object} data - Network data { nodes, edges, circles }
     */
    update(data) {
        if (!this.svg || !this.g) {
            this.init();
        }

        this.nodes = data.nodes || [];
        this.edges = data.edges || [];
        this.circles = data.circles || [];
        this.nodeIndex = new Map(this.nodes.map(node => [node.id, node]));

        this.render();
    }

    /**
     * Render the network
     */
    render() {
        const g = this.g;
        const self = this; // Store reference for use in callbacks

        // Clear existing elements
        g.selectAll('*').remove();

        // Draw circle backgrounds (Venn diagram style)
        const circleGroups = g.selectAll('.circle-bg')
            .data(this.circles)
            .enter()
            .append('g')
            .attr('class', 'circle-bg');

        circleGroups.append('circle')
            .attr('r', (d) => d.radius || 150)
            .attr('cx', (d) => d.x || 0)
            .attr('cy', (d) => d.y || 0)
            .attr('fill', (d) => d.color || '#4285F4')
            .attr('fill-opacity', 0.1)
            .attr('stroke', (d) => d.color || '#4285F4')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '5,5')
            .attr('data-default-stroke', (d) => d.color || '#4285F4')
            .attr('data-default-stroke-width', 2);

        circleGroups.append('text')
            .attr('x', (d) => d.x || 0)
            .attr('y', (d) => (d.y || 0) - (d.radius || 150) - 10)
            .attr('text-anchor', 'middle')
            .attr('font-size', '14px')
            .attr('font-weight', 'bold')
            .attr('fill', (d) => d.color || '#4285F4')
            .text((d) => d.name || d.id);

        // Draw edges
        const links = g.selectAll('.link')
            .data(this.edges)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke', (d) => {
                if (d.type === 'has') return '#666';
                if (d.type === 'contains') return '#999';
                if (d.type === 'message') return '#4285F4';
                return '#ccc';
            })
            .attr('stroke-width', (d) => d.type === 'message' ? 2 : 1)
            .attr('stroke-opacity', 0.6)
            .attr('stroke-dasharray', (d) => d.type === 'message' ? '5,5' : 'none');

        // Create force simulation
        this.simulation = d3.forceSimulation(this.nodes)
            .force('link', d3.forceLink(this.edges).id(d => d.id).distance(100))
            .force('charge', d3.forceManyBody().strength(-300))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(30));

        // Update positions on tick
        this.simulation.on('tick', () => {
            links
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            nodeGroups
                .attr('transform', d => `translate(${d.x},${d.y})`);
        });

        // Draw nodes
        const nodeGroups = g.selectAll('.node')
            .data(this.nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(this.drag());

        // Node shapes based on type
        nodeGroups.each(function(d) {
            const group = d3.select(this);
            
            if (d.type === 'user') {
                group.append('circle')
                    .attr('r', 20)
                    .attr('fill', '#4285F4')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
            } else if (d.type === 'companion') {
                group.append('rect')
                    .attr('width', 40)
                    .attr('height', 40)
                    .attr('x', -20)
                    .attr('y', -20)
                    .attr('fill', '#34A853')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('rx', 4)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
            } else if (d.type === 'coordinator') {
                group.append('polygon')
                    .attr('points', '-15,-15 15,-15 0,15')
                    .attr('fill', '#FBBC04')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
            } else if (d.type === 'handler' || d.type === 'agent') {
                group.append('rect')
                    .attr('width', 30)
                    .attr('height', 30)
                    .attr('x', -15)
                    .attr('y', -15)
                    .attr('fill', d.type === 'handler' ? '#EA4335' : '#9C27B0')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1)
                    .attr('rx', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 1);
            }

            // Node label
            group.append('text')
                .attr('dy', 35)
                .attr('text-anchor', 'middle')
                .attr('font-size', '11px')
                .attr('fill', '#333')
                .text(d.label || d.id);

            // Hardware info tooltip (if enabled)
            if (d.hardware && self.showHardware) {
                group.append('title')
                    .text(() => {
                        const hw = d.hardware;
                        return `Model: ${hw.model || 'N/A'}\nAPI: ${hw.apiStatus || 'N/A'}\nLatency: ${hw.latency || 'N/A'}ms`;
                    });
            }
        });

        // Add click handlers for node details
        nodeGroups.on('click', (event, d) => {
            this.showNodeDetails(d);
        });

        this.nodeSelection = nodeGroups;
        this.circleSelection = circleGroups;
    }

    /**
     * Drag behavior for nodes
     */
    drag() {
        return d3.drag()
            .on('start', (event, d) => {
                if (!event.active) this.simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            })
            .on('drag', (event, d) => {
                d.fx = event.x;
                d.fy = event.y;
            })
            .on('end', (event, d) => {
                if (!event.active) this.simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            });
    }

    /**
     * Show node details in a modal
     */
    showNodeDetails(node) {
        // Create or update details modal
        let modal = document.getElementById('node-details-modal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'node-details-modal';
            modal.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 24px; border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.3); z-index: 1000; max-width: 500px;';
            document.body.appendChild(modal);
        }

        let html = `<h3>${node.label || node.id}</h3>`;
        html += `<p><strong>Type:</strong> ${node.type}</p>`;
        
        if (node.circleIds) {
            html += `<p><strong>Circles:</strong> ${node.circleIds.join(', ')}</p>`;
        }
        
        if (node.hardware && this.showHardware) {
            html += `<div style="margin-top: 16px;"><strong>Hardware:</strong>`;
            html += `<ul style="margin: 8px 0; padding-left: 20px;">`;
            html += `<li>Model: ${node.hardware.model || 'N/A'}</li>`;
            html += `<li>API Status: ${node.hardware.apiStatus || 'N/A'}</li>`;
            html += `<li>Latency: ${node.hardware.latency || 'N/A'}ms</li>`;
            html += `</ul></div>`;
        }

        html += `<button onclick="document.getElementById('node-details-modal').remove()" style="margin-top: 16px; padding: 8px 16px; background: var(--blue-500); color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>`;

        modal.innerHTML = html;
    }

    /**
     * Toggle visibility of logs
     */
    toggleLogs(show) {
        this.showLogs = show;
        // Re-render if needed
    }

    /**
     * Toggle visibility of prompts
     */
    togglePrompts(show) {
        this.showPrompts = show;
        // Re-render if needed
    }

    /**
     * Toggle visibility of hardware info
     */
    toggleHardware(show) {
        this.showHardware = show;
        this.render(); // Re-render to update tooltips
    }

    /**
     * Animate message flow between nodes with improved visualization
     */
    animateMessage(fromNodeId, toNodeId, message) {
        if (!this.svg || !this.g) return;

        const fromNode = this.nodes.find(n => n.id === fromNodeId);
        const toNode = this.nodes.find(n => n.id === toNodeId);

        if (!fromNode || !toNode) {
            // Wait for simulation to update positions
            if (this.simulation) {
                this.simulation.on('tick', () => {
                    const from = this.nodes.find(n => n.id === fromNodeId);
                    const to = this.nodes.find(n => n.id === toNodeId);
                    if (from && to) {
                        this._createMessageAnimation(from, to, message);
                    }
                });
            }
            return;
        }

        this._createMessageAnimation(fromNode, toNode, message);
    }

    /**
     * Create animated message flow visualization
     */
    _createMessageAnimation(fromNode, toNode, message) {
        // Create animated circle that travels along the edge
        const messageCircle = this.g.append('circle')
            .attr('r', 6)
            .attr('fill', '#4285F4')
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .attr('opacity', 0.9);

        // Create message label
        const messageLabel = this.g.append('text')
            .attr('font-size', '10px')
            .attr('fill', '#4285F4')
            .attr('text-anchor', 'middle')
            .text(message.substring(0, 30) + (message.length > 30 ? '...' : ''))
            .attr('opacity', 0);

        // Animate circle along path
        const t = d3.transition()
            .duration(1500)
            .ease(d3.easeLinear);

        messageCircle
            .attr('cx', fromNode.x)
            .attr('cy', fromNode.y)
            .transition(t)
            .attr('cx', toNode.x)
            .attr('cy', toNode.y)
            .on('end', () => {
                messageCircle.remove();
                messageLabel.remove();
            });

        // Animate label
        messageLabel
            .attr('x', fromNode.x)
            .attr('y', fromNode.y - 15)
            .transition(t)
            .attr('x', toNode.x)
            .attr('y', toNode.y - 15)
            .attr('opacity', 0.8)
            .transition()
            .duration(500)
            .attr('opacity', 0);

        // Highlight target node briefly
        const targetNode = this.g.selectAll('.node')
            .filter((d) => d.id === toNode.id);
        
        const shape = targetNode.select('circle,rect,polygon');
        const originalStroke = shape.attr('data-default-stroke') || '#fff';
        const originalWidth = parseFloat(shape.attr('data-default-stroke-width') || 2);
        shape
            .transition()
            .duration(200)
            .attr('stroke-width', 4)
            .attr('stroke', '#4285F4')
            .transition()
            .duration(300)
            .attr('stroke-width', originalWidth)
            .attr('stroke', originalStroke);
    }

    highlightUser(userId, color = '#1a73e8') {
        const baseIds = [
            `user_${userId}`,
            `companion_${userId}`
        ];
        this._pulseNodes(baseIds, color);
    }

    highlightAgent(userId, color = '#9c27b0') {
        const agentIds = [
            `companion_${userId}`,
            `coordinator_${userId}`,
            `handler_input_${userId}`,
            `agent_clinical_${userId}`
        ];
        this._pulseNodes(agentIds, color);
    }

    highlightCircle(circleId, color = '#34a853') {
        if (!this.circleSelection) return;
        this.circleSelection
            .filter((d) => d.id === circleId || d.name?.toLowerCase() === circleId?.toLowerCase())
            .select('circle')
            .transition()
            .duration(200)
            .attr('stroke', color)
            .attr('stroke-width', 4)
            .transition()
            .duration(400)
            .attr('stroke', function() {
                return d3.select(this).attr('data-default-stroke') || '#4285F4';
            })
            .attr('stroke-width', function() {
                return parseFloat(d3.select(this).attr('data-default-stroke-width') || 2);
            });
    }

    _pulseNodes(nodeIds = [], color = '#1a73e8') {
        if (!this.nodeSelection) return;
        nodeIds.forEach(nodeId => {
            const node = this.nodeSelection.filter(d => d.id === nodeId);
            if (node.empty()) return;
            const shape = node.select('circle,rect,polygon');
            if (shape.empty()) return;
            const defaultStroke = shape.attr('data-default-stroke') || '#fff';
            const defaultWidth = parseFloat(shape.attr('data-default-stroke-width') || 2);
            shape
                .transition()
                .duration(150)
                .attr('stroke', color)
                .attr('stroke-width', defaultWidth + 2)
                .transition()
                .duration(400)
                .attr('stroke', defaultStroke)
                .attr('stroke-width', defaultWidth);
        });
    }
}

export default NetworkVisualization;

