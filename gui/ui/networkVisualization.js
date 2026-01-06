/**
 * @fileoverview Network Visualization for Simulations
 * Privacy circles (user + agentic framework) within care circles
 * - Privacy circle = user + handler→coordinator→agent subgraph
 * - Care circle = 3+ privacy circles (patient, caregiver, doctor roles)
 * - Orchestrator sits between privacy circles
 */

export class NetworkVisualization {
    constructor(containerId) {
        this.containerId = containerId;
        this.svg = null;
        this.simulation = null;
        this.nodes = [];
        this.edges = [];
        this.careCircles = []; // Care circles (shaded areas covering multiple privacy circles)
        this.privacyCircles = []; // Privacy circles (user + agentic framework)
        this.showLogs = true;
        this.showPrompts = true;
        this.showHardware = true;
        this.width = 1400;
        this.height = 720;
        this.nodeSelection = null;
        this.careCircleSelection = null;
        this.privacyCircleSelection = null;
        this.nodeIndex = new Map();
        this.userColors = {}; // Map username to color
        this.linkSelection = null;
        this.userMessageGroups = new Map();
        this.userMessageHistory = new Map();
        this.nodePromptHistory = new Map();
        this.userCompanionMap = new Map();
        this.tooltip = null;
        this.markerCache = new Map();
        this.defs = null;
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
        this.markerCache.clear();

        const bounds = container.getBoundingClientRect();
        if (bounds.width) {
            this.width = Math.max(bounds.width, this.width);
        }
        if (bounds.height) {
            this.height = Math.max(bounds.height, this.height);
        }

        if (!this.tooltip) {
            this.tooltip = d3.select('body')
                .append('div')
                .attr('class', 'network-tooltip')
                .style('position', 'fixed')
                .style('padding', '10px 14px')
                .style('border-radius', '8px')
                .style('background', 'rgba(32,33,36,0.92)')
                .style('color', '#fff')
                .style('font-size', '12px')
                .style('line-height', '1.5')
                .style('box-shadow', '0 6px 18px rgba(0,0,0,0.2)')
                .style('pointer-events', 'none')
                .style('z-index', 9999)
                .style('display', 'none');
        }

        // Create SVG
        this.svg = d3.select(`#${this.containerId}`)
            .append('svg')
            .attr('width', this.width)
            .attr('height', this.height);

        this.defs = this.svg.append('defs');
        this._ensureMarker('#999999');

        // Add zoom behavior
        const zoom = d3.zoom()
            .scaleExtent([0.1, 4])
            .on('zoom', (event) => {
                this.svg.select('g').attr('transform', event.transform);
            });

        this.svg.call(zoom);

        // Add help overlay
        const helpOverlay = d3.select(`#${this.containerId}`)
            .append('div')
            .attr('class', 'network-help-overlay')
            .style('position', 'absolute')
            .style('bottom', '10px')
            .style('right', '10px')
            .style('background', 'rgba(255, 255, 255, 0.9)')
            .style('padding', '8px 12px')
            .style('border-radius', '4px')
            .style('font-size', '12px')
            .style('color', '#555')
            .style('pointer-events', 'none')
            .style('box-shadow', '0 2px 5px rgba(0,0,0,0.1)')
            .html('<strong>Controls:</strong> Scroll to Zoom • Drag to Pan')
            .style('display', 'flex')
            .style('flex-direction', 'column')
            .style('gap', '8px')
            .style('align-items', 'flex-end');

        // Add Zoom Buttons Container
        const zoomControls = helpOverlay.append('div')
            .style('display', 'flex')
            .style('gap', '5px')
            .style('pointer-events', 'auto') // Enable clicks on buttons
            .style('margin-top', '5px');

        // Zoom In Button
        zoomControls.append('button')
            .text('+')
            .style('width', '24px')
            .style('height', '24px')
            .style('cursor', 'pointer')
            .style('background', '#fff')
            .style('border', '1px solid #ccc')
            .style('border-radius', '4px')
            .style('font-weight', 'bold')
            .style('color', '#333')
            .on('click', (event) => {
                event.stopPropagation();
                this.svg.transition().duration(300).call(zoom.scaleBy, 1.3);
            });

        // Zoom Out Button
        zoomControls.append('button')
            .text('−')
            .style('width', '24px')
            .style('height', '24px')
            .style('cursor', 'pointer')
            .style('background', '#fff')
            .style('border', '1px solid #ccc')
            .style('border-radius', '4px')
            .style('font-weight', 'bold')
            .style('color', '#333')
            .on('click', (event) => {
                event.stopPropagation();
                this.svg.transition().duration(300).call(zoom.scaleBy, 1 / 1.3);
            });

        // Create main group for zooming/panning
        const g = this.svg.append('g');

        // Store reference to group
        this.g = g;
    }

    reset() {
        if (this.simulation) {
            this.simulation.stop();
            this.simulation = null;
        }
        this.nodes = [];
        this.edges = [];
        this.careCircles = [];
        this.privacyCircles = [];
        this.userColors = {};
        this.nodeIndex.clear();
        this.userCompanionMap.clear();
        this.markerCache.clear();
        this.linkSelection = null;

        this.userMessageGroups.forEach(entry => {
            entry.group?.remove();
        });
        this.userMessageGroups.clear();
        this.userMessageHistory.clear();
        this.nodePromptHistory.clear();

        if (this.svg) {
            this.svg.remove();
            this.svg = null;
            this.g = null;
            this.defs = null;
        }

        const container = document.getElementById(this.containerId);
        if (container) {
            container.innerHTML = '';
        }
    }

    /**
     * Update visualization with new data
     * @param {object} data - Network data { nodes, edges, careCircles, privacyCircles }
     */
    update(data) {
        if (!this.svg || !this.g) {
            this.init();
        }

        this.nodes = data.nodes || [];
        this.edges = data.edges || [];
        this.careCircles = data.careCircles || [];
        this.privacyCircles = data.privacyCircles || [];
        this.userColors = data.userColors || {};
        this.nodeIndex = new Map(this.nodes.map(node => [node.id, node]));
        this.userCompanionMap = new Map();
        this.nodes.forEach(node => {
            if (!node.username) return;
            const username = node.username;
            if (!this.userCompanionMap.has(username)) {
                this.userCompanionMap.set(username, { coordinatorId: null, components: [], componentNodes: new Map() });
            }
            const entry = this.userCompanionMap.get(username);
            if (node.type === 'companion_coordinator') {
                entry.coordinatorId = node.id;
                entry.componentNodes.set('companionCoordinator', node.id);
            } else if (node.type === 'companion_handler' || node.type === 'companion_agent') {
                entry.components.push(node.id);
                if (node.componentId) {
                    entry.componentNodes.set(node.componentId, node.id);
                }
            }
        });

        this.render();
    }

    /**
     * Render the network
     */
    render() {
        const g = this.g;
        const self = this;

        // Clear existing elements
        g.selectAll('*').remove();
        this.userMessageGroups.clear();
        this.userMessageHistory.clear();
        this.nodePromptHistory.clear();

        const defaultMarker = this._ensureMarker('#999999');

        // Draw edges first (so they appear behind nodes)
        const links = g.selectAll('.link')
            .data(this.edges)
            .enter()
            .append('line')
            .attr('class', 'link')
            .attr('stroke', '#999')
            .attr('stroke-width', 1.5)
            .attr('stroke-opacity', 0.45)
            .attr('marker-end', defaultMarker)
            .attr('data-default-stroke', '#999')
            .attr('data-default-stroke-width', 1.5)
            .attr('data-default-opacity', 0.45)
            .attr('data-default-marker', defaultMarker)
            .attr('data-kind', d => d.kind || '')
            .attr('data-link-id', d => `${(d.source?.id || d.source)}__${(d.target?.id || d.target)}`);

        this.linkSelection = links;

        // Create force simulation
        this.simulation = d3.forceSimulation(this.nodes)
            .force('link', d3.forceLink(this.edges).id(d => d.id).distance(60))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(this.width / 2, this.height / 2))
            .force('collision', d3.forceCollide().radius(25));

        // Draw nodes
        const nodeGroups = g.selectAll('.node')
            .data(this.nodes)
            .enter()
            .append('g')
            .attr('class', 'node')
            .call(this.drag());

        // Node shapes - all use user's color (no type-based coloring)
        nodeGroups.each(function (d) {
            const group = d3.select(this);
            const nodeColor = d.color || '#4285F4';
            const type = d.type;

            if (type === 'user') {
                group.append('circle')
                    .attr('r', 20)
                    .attr('fill', nodeColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2.5)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2.5);
            } else if (type === 'companion_coordinator') {
                const size = 18;
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i;
                    points.push([
                        size * Math.cos(angle),
                        size * Math.sin(angle)
                    ]);
                }
                group.append('polygon')
                    .attr('points', points.map(p => p.join(',')).join(' '))
                    .attr('fill', nodeColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
                const abbrev = buildAbbreviation(d.label, 3);
                group.append('text')
                    .attr('text-anchor', 'middle')
                    .attr('dy', 4)
                    .attr('font-size', '10px')
                    .attr('fill', '#fff')
                    .attr('font-weight', '600')
                    .text(abbrev);
            } else if (type === 'companion_handler') {
                group.append('rect')
                    .attr('width', 22)
                    .attr('height', 22)
                    .attr('x', -11)
                    .attr('y', -11)
                    .attr('fill', nodeColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5)
                    .attr('rx', 5)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 1.5);
                const abbrev = buildAbbreviation(d.label, 2);
                group.append('text')
                    .attr('text-anchor', 'middle')
                    .attr('dy', 4)
                    .attr('font-size', '10px')
                    .attr('fill', '#fff')
                    .attr('font-weight', '600')
                    .text(abbrev);
            } else if (type === 'companion_agent') {
                group.append('rect')
                    .attr('width', 20)
                    .attr('height', 20)
                    .attr('x', -10)
                    .attr('y', -10)
                    .attr('fill', nodeColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5)
                    .attr('transform', 'rotate(45)')
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 1.5);
                const abbrev = buildAbbreviation(d.label, 2);
                group.append('text')
                    .attr('text-anchor', 'middle')
                    .attr('dy', 4)
                    .attr('font-size', '10px')
                    .attr('fill', '#fff')
                    .attr('font-weight', '600')
                    .text(abbrev);
            } else if (type === 'orchestrator') {
                const size = 18;
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 3) * i;
                    points.push([
                        size * Math.cos(angle),
                        size * Math.sin(angle)
                    ]);
                }
                group.append('polygon')
                    .attr('points', points.map(p => p.join(',')).join(' '))
                    .attr('fill', '#666')
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
            } else {
                group.append('circle')
                    .attr('r', 16)
                    .attr('fill', nodeColor)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2)
                    .attr('data-default-stroke', '#fff')
                    .attr('data-default-stroke-width', 2);
            }

            group.append('text')
                .attr('dy', 32)
                .attr('text-anchor', 'middle')
                .attr('font-size', '12px')
                .attr('fill', '#333')
                .text(d.label || d.id);

            group.append('title').text(d.label || d.id);
        });

        // Update positions on tick
        this.simulation.on('tick', () => {
            links
                .attr('x1', d => d.source.x)
                .attr('y1', d => d.source.y)
                .attr('x2', d => d.target.x)
                .attr('y2', d => d.target.y);

            nodeGroups
                .attr('transform', d => `translate(${d.x},${d.y})`);

            self._updateMessagePositions();
        });

        // After simulation settles, draw boundaries
        this.simulation.on('end', () => {
            this.drawBoundaries();
        });

        // Interaction handlers
        if (this.linkSelection) {
            this.linkSelection.on('click', (event, d) => {
                event.stopPropagation();
                const sourceId = d.source?.id || d.source;
                const targetId = d.target?.id || d.target;
                this._displayBubbleForNodeId(sourceId, { force: true });
                this._displayBubbleForNodeId(targetId, { force: true });
            });
        }

        nodeGroups.on('click', (event, d) => {
            event.stopPropagation();
            if (d.type === 'user') {
                this._displayUserBubble(d);
            } else {
                this._displayBubbleForNodeId(d.id);
            }
        });

        nodeGroups
            .on('mouseenter', (event, d) => this._handleNodeHover(event, d))
            .on('mousemove', (event) => this._moveTooltip(event))
            .on('mouseleave', () => this._hideTooltip());

        this.nodeSelection = nodeGroups;
    }

    toggleLogs(show) {
        this.showLogs = !!show;
        this.userMessageGroups.forEach((_, nodeId) => {
            this._renderUserMessage(nodeId);
        });
    }

    togglePrompts(show) {
        this.showPrompts = !!show;
        if (!show) {
            this._hideTooltip();
        }
    }

    toggleHardware(show) {
        this.showHardware = !!show;
    }

    animateMessage(fromNodeId, toNodeId, message, context = {}) {
        if (!this.svg || !this.g) return;

        const fromNode = this.nodes.find(n => n.id === fromNodeId);
        const toNode = this.nodes.find(n => n.id === toNodeId);

        if (!fromNode || !toNode) {
            if (this.simulation) {
                this.simulation.on('tick', () => {
                    const from = this.nodes.find(n => n.id === fromNodeId);
                    const to = this.nodes.find(n => n.id === toNodeId);
                    if (from && to) {
                        this._createMessageAnimation(from, to, message, context);
                    }
                });
            }
            return;
        }

        this._createMessageAnimation(fromNode, toNode, message, context);
    }

    _createMessageAnimation(fromNode, toNode, message, context = {}) {
        const messageColor = context.color || ((fromNode.type === 'agent' || fromNode.type === 'companion_agent' || fromNode.type === 'companion_handler' || fromNode.type === 'companion_coordinator')
            ? '#9c27b0'
            : '#1a73e8');

        const travelDuration = context?.travelDuration || 850;

        const transition = d3.transition()
            .duration(travelDuration)
            .ease(d3.easeLinear);

        const messageCircle = this.g.append('circle')
            .attr('r', 7)
            .attr('fill', messageColor)
            .attr('stroke', '#fff')
            .attr('stroke-width', 2)
            .attr('opacity', 0.95)
            .attr('cx', fromNode.x)
            .attr('cy', fromNode.y);

        const messageLabel = this.g.append('text')
            .attr('font-size', '12px')
            .attr('fill', messageColor)
            .attr('text-anchor', 'middle')
            .text(message.length > 50 ? `${message.substring(0, 50)}…` : message)
            .attr('opacity', 0)
            .attr('x', fromNode.x)
            .attr('y', fromNode.y - 18);

        messageCircle
            .transition(transition)
            .attr('cx', toNode.x)
            .attr('cy', toNode.y)
            .on('end', () => {
                messageCircle.remove();
                messageLabel.remove();
            });

        messageLabel
            .transition(transition)
            .attr('x', toNode.x)
            .attr('y', toNode.y - 18)
            .attr('opacity', 0.9)
            .transition()
            .duration(280)
            .attr('opacity', 0);

        const pathEdges = [];
        const username = context.username || fromNode.username || toNode.username;
        const coordinatorId = username ? this.getCoordinatorNodeId(username) : null;
        const userNodeId = username ? `user_${username}` : null;
        const companionEntry = username ? this.userCompanionMap.get(username) : null;
        const componentNodeId = context.componentId && companionEntry
            ? companionEntry.componentNodes?.get(context.componentId)
            : null;
        const companionComponents = companionEntry?.components || [];

        switch (context.direction) {
            case 'user_to_handler':
            case 'user_to_coordinator':
            case 'user_to_agent':
                if (userNodeId && coordinatorId) {
                    pathEdges.push([userNodeId, coordinatorId]);
                }
                if (componentNodeId && coordinatorId) {
                    pathEdges.push([coordinatorId, componentNodeId]);
                } else if (companionComponents.length && coordinatorId) {
                    companionComponents.forEach(component => {
                        pathEdges.push([coordinatorId, component]);
                    });
                }
                if (coordinatorId) {
                    pathEdges.push([coordinatorId, 'orchestrator']);
                }
                break;
            case 'agent_to_user':
                if (componentNodeId && coordinatorId) {
                    pathEdges.push([componentNodeId, coordinatorId]);
                } else if (companionComponents.length && coordinatorId) {
                    companionComponents.forEach(component => {
                        pathEdges.push([component, coordinatorId]);
                    });
                }
                if (coordinatorId && userNodeId) {
                    pathEdges.push([coordinatorId, userNodeId]);
                }
                break;
            case 'orchestrator_to_coordinator':
                if (coordinatorId) {
                    pathEdges.push(['orchestrator', coordinatorId]);
                    if (companionComponents.length) {
                        companionComponents.forEach(component => {
                            pathEdges.push([coordinatorId, component]);
                        });
                    }
                }
                break;
            case 'coordinator_to_orchestrator':
                if (coordinatorId) {
                    pathEdges.push([coordinatorId, 'orchestrator']);
                }
                break;
            case 'coordinator_to_user':
                if (coordinatorId && userNodeId) {
                    pathEdges.push([coordinatorId, userNodeId]);
                }
                break;
            default:
                break;
        }

        pathEdges.push([fromNode.id, toNode.id]);

        const seenEdges = new Set();
        pathEdges.forEach(([sourceId, targetId]) => {
            if (!sourceId || !targetId) return;
            const key = `${sourceId}__${targetId}`;
            if (seenEdges.has(key)) return;
            seenEdges.add(key);
            this._highlightEdge(sourceId, targetId, messageColor, travelDuration);
        });

        this._pulseNodes([fromNode.id, toNode.id], messageColor);

        this._recordNodeMessage(fromNode.id, {
            direction: 'outgoing',
            counterpart: toNode.id,
            message,
            timestamp: Date.now(),
            context
        });
        this._recordNodeMessage(toNode.id, {
            direction: 'incoming',
            counterpart: fromNode.id,
            message,
            timestamp: Date.now(),
            context
        });

        if (username) {
            const userNode = this.nodes.find(n => n.id === `user_${username}`);
            if (userNode) {
                this._showUserMessage(userNode, message, {
                    sender: fromNode,
                    receiver: toNode,
                    color: messageColor,
                    ...context
                });
            }
        }
    }

    /**
     * Draw privacy circle and care circle boundaries after layout settles
     */
    drawBoundaries() {
        const g = this.g;

        // Draw care circle backgrounds first (larger shaded areas)
        const careCircleGroups = g.selectAll('.care-circle-bg')
            .data(this.careCircles)
            .enter()
            .insert('g', ':first-child')
            .attr('class', 'care-circle-bg');

        careCircleGroups.each((d) => {
            const members = d.members || [];
            const memberNodes = this.nodes.filter(n => members.includes(n.username));
            if (memberNodes.length === 0) return;

            // Calculate bounding box
            const xs = memberNodes.map(n => n.x);
            const ys = memberNodes.map(n => n.y);
            const centerX = d3.mean(xs);
            const centerY = d3.mean(ys);
            const radius = Math.max(
                ...memberNodes.map(n => Math.sqrt((n.x - centerX) ** 2 + (n.y - centerY) ** 2))
            ) + 80;

            d3.select(this).append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', radius)
                .attr('fill', d.color || '#e8f4f8')
                .attr('fill-opacity', 0.15)
                .attr('stroke', d.color || '#4285F4')
                .attr('stroke-width', 2)
                .attr('stroke-dasharray', '8,4')
                .attr('stroke-opacity', 0.4);

            d3.select(this).append('text')
                .attr('x', centerX)
                .attr('y', centerY - radius - 12)
                .attr('text-anchor', 'middle')
                .attr('font-size', '13px')
                .attr('font-weight', '600')
                .attr('fill', d.color || '#4285F4')
                .text(d.name || 'Care Circle');
        });

        this.careCircleSelection = careCircleGroups;

        // Draw privacy circle boundaries (smaller circles around user + agentic framework)
        const privacyCircleGroups = g.selectAll('.privacy-circle-bg')
            .data(this.privacyCircles)
            .enter()
            .insert('g', '.node')
            .attr('class', 'privacy-circle-bg');

        privacyCircleGroups.each((d) => {
            const nodeIds = d.nodeIds || [];
            const privacyNodes = this.nodes.filter(n => nodeIds.includes(n.id));
            if (privacyNodes.length === 0) return;

            // Calculate bounding circle
            const xs = privacyNodes.map(n => n.x);
            const ys = privacyNodes.map(n => n.y);
            const centerX = d3.mean(xs);
            const centerY = d3.mean(ys);
            const radius = Math.max(
                ...privacyNodes.map(n => Math.sqrt((n.x - centerX) ** 2 + (n.y - centerY) ** 2))
            ) + 35;

            d3.select(this).append('circle')
                .attr('cx', centerX)
                .attr('cy', centerY)
                .attr('r', radius)
                .attr('fill', 'none')
                .attr('stroke', d.color || '#999')
                .attr('stroke-width', 1.5)
                .attr('stroke-dasharray', '4,2')
                .attr('stroke-opacity', 0.5);
        });

        this.privacyCircleSelection = privacyCircleGroups;
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
            html += `<li>Model: ${node.hardware.model || 'N/A'}</li>`
            html += `<li>API Status: ${node.hardware.apiStatus || 'N/A'}</li>`;
            html += `<li>Latency: ${node.hardware.latency || 'N/A'}ms</li>`;
            html += `</ul></div>`;
        }

        html += `<button onclick="document.getElementById('node-details-modal').remove()" style="margin-top: 16px; padding: 8px 16px; background: var(--blue-500); color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>`;

        modal.innerHTML = html;
    }

    _ensureMarker(color = '#999999') {
        if (!this.svg) return null;
        if (!this.defs || this.defs.empty()) {
            this.defs = this.svg.insert('defs', ':first-child');
        }
        if (!this.defs || this.defs.empty()) {
            return null;
        }
        const normalized = String(color).toLowerCase().replace(/[^a-z0-9]/g, '') || 'default';
        const markerId = `network-arrow-${normalized}`;
        if (!this.markerCache.has(markerId)) {
            const marker = this.defs.append('marker')
                .attr('id', markerId)
                .attr('viewBox', '0 -4 8 8')
                .attr('refX', 9)
                .attr('refY', 0)
                .attr('markerWidth', 8)
                .attr('markerHeight', 8)
                .attr('orient', 'auto')
                .attr('markerUnits', 'userSpaceOnUse');

            marker.append('path')
                .attr('d', 'M0,-4 L8,0 L0,4')
                .attr('fill', color)
                .attr('stroke', 'none');

            this.markerCache.set(markerId, `url(#${markerId})`);
        }
        return this.markerCache.get(markerId);
    }

    _highlightEdge(fromId, toId, color = '#1a73e8', duration = 900) {
        if (!this.linkSelection) return;
        const matches = this.linkSelection.filter((d) => this._edgeMatches(d, fromId, toId));
        if (matches.empty()) return;
        const self = this;

        matches.each(function () {
            const link = d3.select(this);
            const originalStroke = link.attr('data-default-stroke') || '#999';
            const originalWidth = parseFloat(link.attr('data-default-stroke-width') || 1.5);
            const originalOpacity = parseFloat(link.attr('data-default-opacity') || 0.4);
            const defaultMarker = link.attr('data-default-marker') || self._ensureMarker('#999999');
            const highlightMarker = self._ensureMarker(color);
            link.interrupt();
            link
                .transition()
                .duration(120)
                .attr('stroke', color)
                .attr('stroke-width', originalWidth + 2)
                .attr('stroke-opacity', 0.95)
                .attr('marker-end', highlightMarker)
                .transition()
                .duration(duration)
                .attr('stroke', originalStroke)
                .attr('stroke-width', originalWidth)
                .attr('stroke-opacity', originalOpacity)
                .attr('marker-end', defaultMarker);
        });
    }

    _edgeMatches(edge, fromId, toId) {
        if (!edge) return false;
        const sourceId = edge.source?.id || edge.source;
        const targetId = edge.target?.id || edge.target;
        if (!sourceId || !targetId) return false;
        return sourceId === fromId && targetId === toId;
    }

    _updateMessagePositions() {
        if (this.userMessageGroups) {
            this.userMessageGroups.forEach((entry) => {
                this._updateBubbleTransform(entry);
            });
        }

    }

    _updateBubbleTransform(entry) {
        if (!entry || !entry.group) return;
        const anchorId = entry.anchorNodeId;
        if (!anchorId) return;
        const anchorNode = this.nodeIndex.get(anchorId);
        if (!anchorNode) return;
        const offset = entry.offset || { x: 0, y: 0 };
        entry.group.attr('transform', `translate(${(anchorNode.x || 0) + offset.x}, ${(anchorNode.y || 0) + offset.y})`);
    }

    _attachBubbleDrag(entry) {
        if (!entry || !entry.group || entry.dragAttached) return;
        const self = this;
        entry.offset = entry.offset || { x: 0, y: 0 };
        entry.group.call(
            d3.drag()
                .on('start', function () {
                    d3.select(this).raise();
                })
                .on('drag', function (event) {
                    entry.offset.x += event.dx;
                    entry.offset.y += event.dy;
                    self._updateBubbleTransform(entry);
                })
        );
        entry.dragAttached = true;
    }

    _attachBubbleResize(entry, rootNode) {
        if (!rootNode || typeof ResizeObserver === 'undefined') return;
        if (entry.resizeObserver && entry.resizeObserverTarget === rootNode) {
            return;
        }
        if (entry.resizeObserver) {
            entry.resizeObserver.disconnect();
        }
        const observer = new ResizeObserver((entries) => {
            entries.forEach((resizeEntry) => {
                const { width, height } = resizeEntry.contentRect;
                const boundedWidth = Math.max(240, Math.min(width, 680));
                const boundedHeight = Math.max(180, Math.min(height, 520));
                if (Math.abs(boundedWidth - entry.width) > 1 || Math.abs(boundedHeight - entry.height) > 1) {
                    entry.width = boundedWidth;
                    entry.height = boundedHeight;
                    entry.fo
                        .attr('width', entry.width)
                        .attr('height', entry.height)
                        .attr('x', -entry.width / 2)
                        .attr('y', -(entry.height + 32));
                    this._updateBubbleTransform(entry);
                }
            });
        });
        observer.observe(rootNode);
        entry.resizeObserver = observer;
        entry.resizeObserverTarget = rootNode;
    }

    _showUserMessage(userNode, message, context = {}) {
        if (!userNode) return;
        const nodeId = userNode.id;
        if (!this.userMessageHistory.has(nodeId)) {
            this.userMessageHistory.set(nodeId, []);
        }
        const history = this.userMessageHistory.get(nodeId);
        const header = context.sender ? `${this._formatNodeLabel(context.sender)} → ${this._formatNodeLabel(context.receiver)}` : userNode.label || userNode.id;
        history.unshift({ message, timestamp: Date.now(), context: { ...context, header } });
        if (history.length > 30) {
            history.pop();
        }

        const entry = this._getUserEntry(nodeId, true);
        if (entry.visible) {
            this._renderUserMessage(nodeId);
        }

        this._updateBubbleTransform(entry);
    }

    _showOrchestratorMessage(message, { color = '#ea4335', circleName = '', targets = [] } = {}) {
        if (!message) return;
        const orchestratorNode = this.nodeIndex.get('orchestrator') || this.nodes.find(n => n.id === 'orchestrator');
        if (!orchestratorNode) return;

        const receiverLabel = targets?.length ? targets.join(', ') : 'Care circles';
        const context = {
            color,
            circleName,
            targets,
            sender: orchestratorNode,
            receiver: { id: receiverLabel, label: receiverLabel, type: 'targets' },
            direction: 'orchestrator_broadcast'
        };

        this._recordNodeMessage('orchestrator', {
            direction: 'outgoing',
            counterpart: targets,
            message,
            timestamp: Date.now(),
            context
        });
        this._showUserMessage(orchestratorNode, message, context);
    }

    animateOrchestratorAction({ targetUsers = [], message = '', actionType = 'escalation', circleName = '' } = {}) {
        const orchestratorNode = this.nodes.find((n) => n.id === 'orchestrator');
        if (!orchestratorNode) return;

        const color = actionType === 'escalation' ? '#ea4335' : '#1a73e8';
        this._pulseNodes(['orchestrator'], color);

        targetUsers.forEach((username, index) => {
            if (!username) return;
            const coordinatorId = this.getCoordinatorNodeId?.(username);
            if (coordinatorId) {
                const delay = index * 120;
                const userNodeId = `user_${username}`;
                const companionEntry = this.userCompanionMap.get(username);
                const componentIds = companionEntry?.components || [];

                const sendToCoordinator = () => {
                    this.animateMessage('orchestrator', coordinatorId, message, {
                        username,
                        direction: 'orchestrator_to_coordinator',
                        travelDuration: 650
                    });
                };

                const sendToUser = () => {
                    this.animateMessage(coordinatorId, userNodeId, message, {
                        username,
                        direction: 'coordinator_to_user',
                        travelDuration: 650
                    });
                };

                setTimeout(sendToCoordinator, delay);
                setTimeout(sendToUser, delay + 140);

                if (componentIds.length) {
                    componentIds.forEach((componentId, componentIndex) => {
                        setTimeout(() => {
                            this._highlightEdge(coordinatorId, componentId, color, 650);
                        }, delay + 100 + componentIndex * 60);
                    });
                }
            }
        });

        this._showOrchestratorMessage(message, { color, circleName, targets: targetUsers });
    }

    _formatNodeLabel(node) {
        if (!node) return 'Message';
        const baseLabel = node.label || node.type || node.id;
        const username = node.username || node.id?.replace(/^(user|handler|coordinator|agent)_/, '');
        if (node.type === 'user') {
            return baseLabel;
        }
        return `${baseLabel} · ${username}`;
    }

    _escapeHtml(text = '') {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    highlightUser(userId, color = '#1a73e8') {
        const baseIds = [`user_${userId}`];
        this._pulseNodes(baseIds, color);
    }

    highlightAgent(userId, color = '#9c27b0') {
        const entry = this.userCompanionMap.get(userId);
        if (!entry) return;
        const nodeIds = [];
        if (entry.coordinatorId) {
            nodeIds.push(entry.coordinatorId);
        }
        if (entry.components && entry.components.length) {
            nodeIds.push(...entry.components);
        }
        this._pulseNodes(nodeIds, color);
    }

    getUserColor(username) {
        return this.userColors ? this.userColors[username] : undefined;
    }

    getCoordinatorNodeId(username) {
        return this.userCompanionMap.get(username)?.coordinatorId || null;
    }

    highlightCircle(circleId, color = '#34a853') {
        if (!this.careCircleSelection) return;
        this.careCircleSelection
            .filter((d) => d.id === circleId || d.name?.toLowerCase() === circleId?.toLowerCase())
            .select('circle')
            .transition()
            .duration(200)
            .attr('stroke', color)
            .attr('stroke-width', 4)
            .transition()
            .duration(400)
            .attr('stroke', (d) => d.color || '#4285F4')
            .attr('stroke-width', 2);
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

    _recordNodeMessage(nodeId, record) {
        if (!nodeId) return;
        if (!this.nodePromptHistory.has(nodeId)) {
            this.nodePromptHistory.set(nodeId, []);
        }
        const history = this.nodePromptHistory.get(nodeId);
        history.unshift(record);
        if (history.length > 20) {
            history.pop();
        }
    }

    _getUserEntry(nodeId, createIfMissing = false) {
        let entry = this.userMessageGroups.get(nodeId);
        if (!entry && createIfMissing) {
            const group = this.g.append('g')
                .attr('class', 'user-bubble')
                .style('pointer-events', 'none')
                .style('display', 'none');
            const fo = group.append('foreignObject')
                .attr('width', 320)
                .attr('height', 220)
                .attr('x', -160)
                .attr('y', -260);
            entry = {
                group,
                fo,
                width: 320,
                height: 220,
                collapsed: false,
                history: [],
                visible: false,
                offset: { x: 0, y: 0 },
                anchorNodeId: nodeId,
                resizeObserver: null,
                resizeObserverTarget: null
            };
            this.userMessageGroups.set(nodeId, entry);
            this._attachBubbleDrag(entry);
        } else if (entry) {
            entry.anchorNodeId = entry.anchorNodeId || nodeId;
            entry.offset = entry.offset || { x: 0, y: 0 };
        }
        return entry;
    }

    _renderUserMessage(nodeId) {
        const entry = this.userMessageGroups.get(nodeId);
        if (!entry) return;
        const history = this.userMessageHistory.get(nodeId) || [];
        entry.history = history;
        if (!this.showLogs || !entry.visible) {
            entry.group.style('display', 'none');
            entry.group.style('pointer-events', 'none');
            return;
        }
        entry.group.style('display', null);
        entry.group.style('pointer-events', 'auto');

        const latestContext = history[0]?.context || {};
        const header = latestContext.header || history[0]?.header || 'Conversation';
        const nodeMeta = this.nodeIndex.get(nodeId);
        const isUserBubble = nodeMeta?.type === 'user' || nodeId === 'orchestrator';

        const bodyItems = history.map(item => {
            const time = new Date(item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const directionLabel = item.context?.direction === 'agent_to_user' ? 'Agent → User' : item.context?.direction === 'user_to_agent' ? 'User → Agent' : '';
            const safeMessage = this._escapeHtml(item.message).replace(/\n/g, '<br>');
            return `
                <div style="padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.05);">
                    <div style="font-size: 11px; color: #5f6368; display: flex; justify-content: space-between;">
                        <span>${directionLabel}</span>
                        <span>${time}</span>
                    </div>
                    <div style="margin-top: 4px; color: #1f1f1f; font-size: 13px; line-height: 1.55;">${safeMessage}</div>
                </div>`;
        }).join('') || '<div style="padding: 12px; color: #5f6368;">No messages yet.</div>';

        const bodyDisplay = entry.collapsed ? 'none' : 'block';
        const toggleLabel = entry.collapsed ? 'Expand' : 'Minimize';

        entry.fo
            .attr('width', entry.width)
            .attr('height', entry.height)
            .attr('x', -entry.width / 2)
            .attr('y', -(entry.height + 32))
            .html(`
                <div class="bubble-root" style="width:100%; height:100%; min-width:240px; min-height:180px; max-width:680px; max-height:520px; resize: both; overflow: hidden; border-radius: 12px; box-shadow: 0 12px 30px rgba(0,0,0,0.18); font-family: 'Segoe UI', sans-serif; background: rgba(255,255,255,0.98); display: flex; flex-direction: column;">
                    <div class="bubble-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 16px; border-bottom: 1px solid rgba(0,0,0,0.06); background: #f8f9fa; border-top-left-radius: 12px; border-top-right-radius: 12px; gap: 8px;">
                        <div style="font-weight: 600; font-size: 13px; color: #1f1f1f; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${this._escapeHtml(header)}</div>
                        <div style="display: flex; gap: 6px; align-items: center;">
                            ${isUserBubble ? `<button class="bubble-toggle" style="font-size: 11px; padding: 4px 10px; border: 1px solid #dadce0; background: white; border-radius: 999px; cursor: pointer;">${toggleLabel}</button>` : ''}
                            <button class="bubble-close" style="font-size: 12px; padding: 4px 8px; border: 1px solid #dadce0; background: white; border-radius: 999px; cursor: pointer;">✕</button>
                        </div>
                    </div>
                    <div class="bubble-body" style="display: ${bodyDisplay}; padding: 12px 16px; overflow-y: auto; flex: 1;">
                        ${bodyItems}
                    </div>
                </div>
            `);

        const foNode = entry.fo.node();
        const rootNode = foNode?.querySelector('.bubble-root');
        this._attachBubbleResize(entry, rootNode);
        const toggleBtn = isUserBubble ? foNode?.querySelector('.bubble-toggle') : null;
        const closeBtn = foNode?.querySelector('.bubble-close');

        if (toggleBtn) {
            toggleBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                entry.collapsed = !entry.collapsed;
                this._renderUserMessage(nodeId);
            };
        }

        if (closeBtn) {
            closeBtn.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                entry.visible = false;
                entry.group.style('display', 'none');
                entry.group.style('pointer-events', 'none');
            };
        }

        this._updateMessagePositions();
    }

    _showUserMessage(userNode, message, context = {}) {
        if (!userNode) return;
        const nodeId = userNode.id;
        if (!this.userMessageHistory.has(nodeId)) {
            this.userMessageHistory.set(nodeId, []);
        }
        const history = this.userMessageHistory.get(nodeId);
        const header = context.sender ? `${this._formatNodeLabel(context.sender)} → ${this._formatNodeLabel(context.receiver)}` : userNode.label || userNode.id;
        history.unshift({ message, timestamp: Date.now(), context: { ...context, header } });
        if (history.length > 30) {
            history.pop();
        }

        const entry = this._getUserEntry(nodeId, true);
        if (entry.visible) {
            this._renderUserMessage(nodeId);
        }
        this._updateBubbleTransform(entry);
    }

    _displayUserBubble(userNode, options = {}) {
        if (!userNode) return;
        const { force = false } = options;
        const nodeId = userNode.id;
        if (!this.userMessageHistory.has(nodeId)) {
            this.userMessageHistory.set(nodeId, []);
        }
        const entry = this._getUserEntry(nodeId, true);
        entry.anchorNodeId = nodeId;
        if (!force && entry.visible) {
            entry.visible = false;
            entry.group.style('display', 'none');
            entry.group.style('pointer-events', 'none');
            return;
        }

        entry.collapsed = false;
        entry.visible = true;
        entry.group.style('display', null);
        entry.group.style('pointer-events', 'auto');
        this._renderUserMessage(nodeId);
        this._updateBubbleTransform(entry);
    }

    _displayBubbleForNodeId(nodeId, options = {}) {
        if (!nodeId) return;
        const resolvedUserId = this._resolveUserNodeId(nodeId);
        if (!resolvedUserId) return;
        const userNode = this.nodeIndex.get(resolvedUserId);
        if (userNode) {
            this._displayUserBubble(userNode, options);
        }
    }

    _resolveUserNodeId(nodeId) {
        if (!nodeId) return null;
        if (nodeId.startsWith('user_')) {
            return nodeId;
        }
        const meta = this.nodeIndex.get(nodeId);
        if (meta && meta.username) {
            return `user_${meta.username}`;
        }
        return null;
    }

    _handleNodeHover(event, node) {
        if (!this.showPrompts || !this.tooltip) return;
        const history = this.nodePromptHistory.get(node.id);
        if (!history || !history.length) return;
        const topEntries = history.slice(0, 5).map(item => {
            const time = new Date(item.timestamp || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const counter = Array.isArray(item.counterpart) ? item.counterpart.join(', ') : item.counterpart;
            return `
                <div style="margin-bottom: 6px;">
                    <div style="font-size: 11px; color: rgba(255,255,255,0.7);">${time}${counter ? ` · ${this._escapeHtml(String(counter))}` : ''}</div>
                    <div style="margin-top: 2px; font-size: 12px;">${this._escapeHtml(item.message)}</div>
                </div>`;
        }).join('');

        this.tooltip
            .style('display', 'block')
            .html(topEntries || '<div style="font-size: 12px;">No prompts yet.</div>');

        this._moveTooltip(event);
    }

    _moveTooltip(event) {
        if (!this.tooltip || this.tooltip.style('display') === 'none') return;
        const { clientX, clientY } = event;
        const offset = 16;
        this.tooltip
            .style('left', `${clientX + offset}px`)
            .style('top', `${clientY + offset}px`);
    }

    _hideTooltip() {
        if (this.tooltip) {
            this.tooltip.style('display', 'none');
        }
    }
}

function buildAbbreviation(label = '', maxLength = 2) {
    if (!label) return '';
    const letters = label
        .split(/\s+/)
        .filter(Boolean)
        .map(word => word[0])
        .join('')
        .toUpperCase();
    return letters.slice(0, Math.max(1, maxLength));
}

export default NetworkVisualization;