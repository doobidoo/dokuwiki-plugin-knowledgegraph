var KnowledgeGraph = (function() {
    var instance = {
        svg: null,
        simulation: null,
        link: null,
        node: null,
        zoom: null,
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
                    <select id="namespace-filter" class="graph-control">
                        <option value="">All Namespaces</option>
                    </select>
                    <button id="back-button" class="graph-control" disabled>↩ Back</button>
                    <div class="graph-legend">
                        <span class="legend-item"><span class="legend-color hierarchy"></span>Hierarchy</span>
                        <span class="legend-item"><span class="legend-color namespace"></span>Namespace</span>
                        <span class="legend-item"><span class="legend-color reference"></span>Reference</span>
                        <span class="legend-item"><span class="legend-color tag"></span>Tag</span>
                    </div>
                </div>
                <div class="graph-search">
                    <input type="text" id="node-search" placeholder="Search pages..." class="graph-control">
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

                // Add zoom behavior
                this.zoom = d3.zoom()
                    .scaleExtent([0.1, 4])
                    .on("zoom", (event) => {
                        this.svg.select("g").attr("transform", event.transform);
                    });

                this.svg.call(this.zoom);
                this.svg = this.svg.append("g");

                // Setup event listeners
                this.setupEventListeners();
                this.loadGraph();
            } catch (error) {
                console.error('Error initializing graph:', error);
            }
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

            // Search functionality
            document.getElementById('node-search').addEventListener('input', (e) => {
                const searchTerm = e.target.value.toLowerCase();
                this.highlightNodes(searchTerm);
            });
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
            this.svg.selectAll("*").remove();

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
            this.simulation = d3.forceSimulation(this.visibleNodes)
                .force("link", d3.forceLink(this.visibleLinks)
                    .id(d => d.id)
                    .distance(d => {
                        switch(d.type) {
                            case 'hierarchy': return 80;
                            case 'namespace': return 100;
                            case 'reference': return 150;
                            case 'tag': return 200;
                            default: return 100;
                        }
                    }))
                .force("charge", d3.forceManyBody()
                    .strength(d => this.hasChildren(d) ? -1000 : -500))
                .force("center", d3.forceCenter(this.width / 2, this.height / 2))
                .force("collide", d3.forceCollide()
                    .radius(d => this.hasChildren(d) ? 50 : 30)
                    .strength(0.7));

            // Create links with different styles per type
            this.link = this.svg.append("g")
                .selectAll("line")
                .data(this.visibleLinks)
                .enter().append("line")
                .attr("class", d => `edge edge-${d.type}`)
                .attr("marker-end", d => `url(#arrow-${d.type})`)
                .attr("stroke-width", d => Math.sqrt(d.weight || 1));

            // Create node groups
            this.node = this.svg.append("g")
                .selectAll("g")
                .data(this.visibleNodes)
                .enter().append("g")
                .attr("class", "node")
                .call(d3.drag()
                    .on("start", this.dragstarted.bind(this))
                    .on("drag", this.dragged.bind(this))
                    .on("end", this.dragended.bind(this)));

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

            // Update simulation
            this.simulation.on("tick", () => {
                this.link
                    .attr("x1", d => d.source.x)
                    .attr("y1", d => d.source.y)
                    .attr("x2", d => d.target.x)
                    .attr("y2", d => d.target.y);

                this.node.attr("transform", d => `translate(${d.x},${d.y})`);
            });
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

        dragstarted: function(event) {
            if (!event.active) this.simulation.alphaTarget(0.3).restart();
            event.subject.fx = event.subject.x;
            event.subject.fy = event.subject.y;
        },

        dragged: function(event) {
            event.subject.fx = event.x;
            event.subject.fy = event.y;
        },

        dragended: function(event) {
            if (!event.active) this.simulation.alphaTarget(0);
            event.subject.fx = null;
            event.subject.fy = null;
        }
    };

    return instance;
})();