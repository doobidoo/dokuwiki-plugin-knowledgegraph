var KnowledgeGraph = (function() {
    var instance = {
        svg: null,
        simulation: null,
        link: null,
        node: null,
        zoom: null,
        container: null,
        width: 0,
        height: 0,
        initialized: false,
        allNodes: [],
        allLinks: [],
        visibleNodes: [],
        visibleLinks: [],
        currentNamespace: "",
        expandedNodes: new Set(),

        init: function() {
            if (this.initialized || !document.getElementById('graph-container')) return;
            this.initialized = true;

            // Create container and controls
            const container = document.getElementById('graph-container');
            container.innerHTML = `
                <div class="graph-controls">
                    <select id="layout-type" class="graph-control">
                        <option value="force">Force-Directed</option>
                        <option value="disjoint">Disjoint Force-Directed</option>
                        <option value="radial">Radial</option>
                        <option value="hierarchical">Hierarchical</option>
                    </select>
                    <select id="namespace-filter" class="graph-control">
                        <option value="">All Namespaces</option>
                    </select>
                    <button id="back-button" class="graph-control" disabled>↩ Back</button>
                    <button id="reset-view" class="graph-control">Reset View</button>
                    <div class="graph-legend">
                        <label class="legend-item">
                            <input type="checkbox" class="edge-filter" value="hierarchy" checked>
                            <span class="legend-color hierarchy"></span>Hierarchy
                        </label>
                        <label class="legend-item">
                            <input type="checkbox" class="edge-filter" value="namespace" checked>
                            <span class="legend-color namespace"></span>Namespace
                        </label>
                        <label class="legend-item">
                            <input type="checkbox" class="edge-filter" value="reference" checked>
                            <span class="legend-color reference"></span>Reference
                        </label>
                        <label class="legend-item">
                            <input type="checkbox" class="edge-filter" value="tag" checked>
                            <span class="legend-color tag"></span>Tag
                        </label>
                    </div>
                </div>
                <div class="graph-search">
                    <input type="text" id="node-search" placeholder="Search pages..." class="graph-control" disabled>
                </div>
                <div id="graph-svg-container"></div>
                <div id="node-preview" class="node-preview"></div>
            `;

            try {
                const svgContainer = document.getElementById('graph-svg-container');
                this.width = svgContainer.offsetWidth;
                this.height = svgContainer.offsetHeight || 600;
                
                this.svg = d3.select("#graph-svg-container")
                    .append("svg")
                    .attr("width", this.width)
                    .attr("height", this.height);

                // Add zoom behavior with proper transform
                this.zoom = d3.zoom()
                    .scaleExtent([0.1, 4])
                    .on("zoom", (event) => {
                        // Apply zoom transform to a container group that holds both nodes and links
                        this.container.attr("transform", event.transform);
                    });

                this.svg.call(this.zoom);
                
                // Create a container group for both nodes and links
                this.container = this.svg.append("g");

                // Setup event listeners
                this.setupEventListeners();
                this.loadGraph();
            } catch (error) {
                console.error('Error initializing graph:', error);
            }

            // Add layout type change handler
            document.getElementById('layout-type').addEventListener('change', (e) => {
                this.updateLayout(e.target.value);
            });
        },

        setupEventListeners: function() {
            // Back button
            document.getElementById('back-button').addEventListener('click', () => {
                if (this.currentNamespace) {
                    const parts = this.currentNamespace.split(':');
                    parts.pop();
                    this.showNamespace(parts.join(':'));
                }
            });

            // Reset view button
            document.getElementById('reset-view').addEventListener('click', () => {
                this.resetView();
            });

            // Edge type filters
            document.querySelectorAll('.edge-filter').forEach(checkbox => {
                checkbox.addEventListener('change', () => {
                    this.updateEdgeVisibility();
                });
            });

            // Search functionality
            const searchInput = document.getElementById('node-search');
            
            // Enable the search input
            searchInput.disabled = false;
            
            searchInput.addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                
                // Clear highlight if search is empty
                if (!searchTerm) {
                    this.node.classed('search-highlight', false)
                        .style('opacity', 1);
                    this.link.style('opacity', 1);
                    return;
                }

                // Update node visibility and highlighting
                this.node.each(d => {
                    const matches = d.name.toLowerCase().includes(searchTerm) ||
                                  d.id.toLowerCase().includes(searchTerm) ||
                                  (d.tags && d.tags.some(tag => tag.toLowerCase().includes(searchTerm)));
                    
                    d.matched = matches;
                });

                // Update visual states
                this.node
                    .classed('search-highlight', d => d.matched)
                    .style('opacity', d => d.matched ? 1 : 0.2);

                // Update edge visibility based on connected nodes
                this.link.style('opacity', d => 
                    (d.source.matched || d.target.matched) ? 1 : 0.1
                );
            });
        },

        resetView: function() {
            if (!this.svg || !this.zoom) return;
            
            // Calculate the bounds of the graph
            const bounds = this.container.node().getBBox();
            const parent = this.svg.node().parentElement;
            const fullWidth = parent.clientWidth;
            const fullHeight = parent.clientHeight;
            
            const midX = bounds.x + bounds.width / 2;
            const midY = bounds.y + bounds.height / 2;
            
            // Calculate the scale to fit the graph
            const scale = 0.9 / Math.max(bounds.width / fullWidth, bounds.height / fullHeight);
            
            // Calculate the transform to center and scale the graph
            const transform = d3.zoomIdentity
                .translate(fullWidth / 2 - midX * scale, fullHeight / 2 - midY * scale)
                .scale(scale);
            
            // Apply the transform with a smooth transition
            this.svg.transition()
                .duration(750)
                .call(this.zoom.transform, transform);
        },

        highlightNodes: function(searchTerm) {
            if (!this.node) return;
            
            this.node.classed('search-highlight', d => 
                d.name.toLowerCase().includes(searchTerm) ||
                d.id.toLowerCase().includes(searchTerm) ||
                (d.tags && d.tags.some(tag => tag.toLowerCase().includes(searchTerm)))
            );
        },

        loadGraph: function() {
            fetch(DOKU_BASE + 'lib/exe/ajax.php', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: 'call=plugin_knowledgegraph&req=getgraph'
            })
            .then(response => response.json())
            .then(data => {
                if (!data.nodes || !data.edges) {
                    throw new Error('Invalid graph data structure');
                }

                // Process and store the complete graph data
                this.allNodes = data.nodes.map(node => ({
                    ...node,
                    level: node.id.split(':').length - 1,
                    parent: node.id.split(':').slice(0, -1).join(':')
                }));
                
                this.allLinks = data.edges;
                this.setupNamespaceFilter(data.namespaces);
                this.showNamespace("");  // Show top-level nodes initially
            })
            .catch(error => console.error('Error loading graph data:', error));
        },

        showNamespace: function(namespace) {
            this.currentNamespace = namespace;
            
            // Update back button state
            document.getElementById('back-button').disabled = !namespace;
            
            // Filter nodes based on namespace and expanded state
            this.visibleNodes = this.allNodes.filter(node => {
                if (this.expandedNodes.has(node.id)) return true;
                if (namespace === "") {
                    return node.level === 0;
                }
                if (node.id === namespace) return true;
                if (!node.id.startsWith(namespace + ':')) return false;
                const remainingPath = node.id.substring(namespace.length + 1);
                return !remainingPath.includes(':');
            });

            // Filter links for visible nodes
            const visibleNodeIds = new Set(this.visibleNodes.map(n => n.id));
            this.visibleLinks = this.allLinks.filter(link => 
                visibleNodeIds.has(link.source) && visibleNodeIds.has(link.target)
            );

            this.renderGraph();
        },

        renderGraph: function() {
            // Clear existing graph
            this.container.selectAll("*").remove();

            // Add arrow markers for different edge types
            const defs = this.svg.append("defs");
            ['hierarchy', 'namespace', 'reference', 'tag'].forEach(type => {
                defs.append("marker")
                    .attr("id", `arrow-${type}`)
                    .attr("viewBox", "0 -5 10 10")
                    .attr("refX", 20)
                    .attr("refY", 0)
                    .attr("markerWidth", 6)
                    .attr("markerHeight", 6)
                    .attr("orient", "auto")
                    .append("path")
                    .attr("d", "M0,-5L10,0L0,5")
                    .attr("class", `edge-${type}`);
            });

            // Set up forces
            this.updateSimulation();

            // Create links with different styles per type
            this.link = this.container.append("g")
                .selectAll("line")
                .data(this.visibleLinks)
                .enter().append("line")
                .attr("class", d => `edge edge-${d.type}`)
                .attr("marker-end", d => `url(#arrow-${d.type})`)
                .attr("stroke-width", d => Math.sqrt(d.weight || 1));

            // Create node groups with proper drag behavior
            this.node = this.container.selectAll("g")
                .data(this.visibleNodes)
                .enter().append("g")
                .attr("class", "node")
                .call(d3.drag()
                    .on("start", (event, d) => {
                        if (!event.active) this.simulation.alphaTarget(0.3).restart();
                        d.fx = d.x;
                        d.fy = d.y;
                    })
                    .on("drag", (event, d) => {
                        d.fx = event.x;
                        d.fy = event.y;
                    })
                    .on("end", (event, d) => {
                        if (!event.active) this.simulation.alphaTarget(0);
                        d.fx = null;
                        d.fy = null;
                    })
                );

            // Add circles for nodes
            this.node.append("circle")
                .attr("r", d => this.hasChildren(d) ? 12 : 8)
                .style("fill", d => this.getNamespaceColor(d.id))
                .style("cursor", "pointer")
                .on("click", this.handleNodeClick.bind(this))
                .on("mouseover", this.showNodePreview.bind(this))
                .on("mouseout", this.hideNodePreview.bind(this))
                .on("dblclick", this.navigateToPage.bind(this));

            // Add text labels
            this.node.append("text")
                .attr("dx", 15)
                .attr("dy", 5)
                .text(d => d.name)
                .style("font-size", "12px")
                .style("pointer-events", "none");

            // Add expand/collapse indicators
            this.node.filter(d => this.hasChildren(d))
                .append("text")
                .attr("class", "expand-indicator")
                .attr("dx", -5)
                .attr("dy", 5)
                .text(d => this.expandedNodes.has(d.id) ? "-" : "+")
                .style("font-size", "16px")
                .style("font-weight", "bold");

            // Add tooltips with full path
            this.node.append("title")
                .text(d => d.path);
        },

        updateSimulation: function() {
            if (!this.simulation) {
                this.simulation = d3.forceSimulation()
                    .force("link", d3.forceLink()
                        .id(d => d.id)
                        .distance(d => 100 / (d.weight || 1))
                    )
                    .force("charge", d3.forceManyBody()
                        .strength(-200)  // Increased repulsion
                    )
                    .force("center", d3.forceCenter(this.width / 2, this.height / 2))
                    .force("x", d3.forceX(this.width / 2).strength(0.1))  // Increased gravity
                    .force("y", d3.forceY(this.height / 2).strength(0.1))  // Increased gravity
                    .on("tick", () => this.tick());
            }

            this.simulation.nodes(this.visibleNodes);
            this.simulation.force("link").links(this.visibleLinks);
            this.simulation.alpha(1).restart();
        },

        tick: function() {
            this.link
                .attr("x1", d => d.source.x)
                .attr("y1", d => d.source.y)
                .attr("x2", d => d.target.x)
                .attr("y2", d => d.target.y);

            this.node.attr("transform", d => `translate(${d.x},${d.y})`);
        },

        handleNodeClick: function(event, d) {
            if (!this.hasChildren(d)) return;
            
            if (this.expandedNodes.has(d.id)) {
                this.expandedNodes.delete(d.id);
            } else {
                this.expandedNodes.add(d.id);
            }
            
            this.showNamespace(this.currentNamespace);
        },

        showNodePreview: function(event, d) {
            const preview = document.getElementById('node-preview');
            preview.innerHTML = `
                <h3>${d.name}</h3>
                <p>Namespace: ${d.namespace || 'Root'}</p>
                ${d.tags && d.tags.length ? `<p>Tags: ${d.tags.join(', ')}</p>` : ''}
            `;
            preview.style.display = 'block';
            preview.style.left = `${event.pageX + 10}px`;
            preview.style.top = `${event.pageY + 10}px`;
        },

        hideNodePreview: function() {
            document.getElementById('node-preview').style.display = 'none';
        },

        navigateToPage: function(event, d) {
            window.location.href = DOKU_BASE + d.id;
        },

        hasChildren: function(node) {
            return this.allNodes.some(n => 
                n.id !== node.id && 
                n.id.startsWith(node.id + ':') &&
                n.id.split(':').length === node.id.split(':').length + 1
            );
        },

        getNamespaceColor: function(id) {
            const namespace = id.split(':')[0] || 'root';
            return d3.interpolateRainbow(
                (Array.from(new Set(this.allNodes.map(n => n.id.split(':')[0] || 'root')))
                    .indexOf(namespace) * 0.1) % 1
            );
        },

        setupNamespaceFilter: function(namespaces) {
            const select = document.getElementById('namespace-filter');
            select.innerHTML = '<option value="">All Namespaces</option>';
            
            namespaces.sort().forEach(ns => {
                const option = document.createElement('option');
                option.value = ns;
                option.textContent = ns;
                select.appendChild(option);
            });

            select.addEventListener('change', (e) => {
                this.showNamespace(e.target.value);
            });
        },

        updateEdgeVisibility: function() {
            const activeTypes = Array.from(document.querySelectorAll('.edge-filter:checked'))
                .map(cb => cb.value);
            
            this.link.style('display', d => 
                activeTypes.includes(d.type) ? 'block' : 'none'
            );
        },

        updateLayout: function(layoutType) {
            if (!this.simulation) return;
            
            // Stop current simulation
            this.simulation.stop();
            
            switch(layoutType) {
                case 'disjoint':
                    this.simulation
                        .force("link", d3.forceLink()
                            .id(d => d.id)
                            .distance(d => 100 / (d.weight || 1))
                            .strength(0.5)
                        )
                        .force("charge", d3.forceManyBody()
                            .strength(-300)
                        )
                        .force("center", null)  // Remove center force
                        .force("x", d3.forceX(this.width / 2).strength(0.1))
                        .force("y", d3.forceY(this.height / 2).strength(0.1))
                        .force("cluster", this.forceCluster());
                    break;
                    
                case 'radial':
                    this.simulation
                        .force("link", d3.forceLink()
                            .id(d => d.id)
                            .distance(d => 100 / (d.weight || 1))
                        )
                        .force("charge", d3.forceManyBody().strength(-200))
                        .force("center", null)
                        .force("r", d3.forceRadial(
                            d => d.depth * 100,
                            this.width / 2,
                            this.height / 2
                        ).strength(1))
                        .force("x", null)
                        .force("y", null);
                    break;
                    
                case 'hierarchical':
                    // Create hierarchy based on namespaces
                    const hierarchy = d3.stratify()
                        .id(d => d.id)
                        .parentId(d => {
                            const parts = d.id.split(':');
                            return parts.length > 1 ? parts.slice(0, -1).join(':') : null;
                        })(this.visibleNodes);
                        
                    const treeLayout = d3.tree()
                        .size([this.width - 100, this.height - 100]);
                        
                    const nodes = treeLayout(hierarchy);
                    
                    // Update node positions based on tree layout
                    this.visibleNodes.forEach(node => {
                        const treeNode = nodes.find(n => n.id === node.id);
                        if (treeNode) {
                            node.x = treeNode.x + 50;
                            node.y = treeNode.y + 50;
                            node.fx = node.x;
                            node.fy = node.y;
                        }
                    });
                    
                    this.simulation
                        .force("link", d3.forceLink()
                            .id(d => d.id)
                            .distance(50)
                        )
                        .force("charge", null)
                        .force("center", null)
                        .force("x", null)
                        .force("y", null);
                    break;
                    
                default: // force-directed
                    this.simulation
                        .force("link", d3.forceLink()
                            .id(d => d.id)
                            .distance(d => 100 / (d.weight || 1))
                        )
                        .force("charge", d3.forceManyBody().strength(-200))
                        .force("center", d3.forceCenter(this.width / 2, this.height / 2))
                        .force("x", d3.forceX(this.width / 2).strength(0.1))
                        .force("y", d3.forceY(this.height / 2).strength(0.1));
                    
                    // Clear any fixed positions
                    this.visibleNodes.forEach(node => {
                        delete node.fx;
                        delete node.fy;
                    });
                    break;
            }
            
            // Restart simulation
            this.simulation.alpha(1).restart();
        },

        forceCluster: function() {
            const nodes = this.visibleNodes;
            const namespaces = [...new Set(nodes.map(d => d.namespace))];
            const centers = {};
            
            // Assign cluster centers
            namespaces.forEach((ns, i) => {
                const angle = (2 * Math.PI * i) / namespaces.length;
                const radius = Math.min(this.width, this.height) / 4;
                centers[ns] = {
                    x: this.width/2 + radius * Math.cos(angle),
                    y: this.height/2 + radius * Math.sin(angle)
                };
            });
            
            return function(alpha) {
                nodes.forEach(d => {
                    const center = centers[d.namespace] || centers[''];
                    if (center) {
                        d.vx += (center.x - d.x) * alpha * 0.5;
                        d.vy += (center.y - d.y) * alpha * 0.5;
                    }
                });
            };
        }
    };

    return instance;
})();