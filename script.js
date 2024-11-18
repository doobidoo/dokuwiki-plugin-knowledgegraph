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

        init: function() {
            if (this.initialized || !document.getElementById('graph-container')) return;
            this.initialized = true;

            const container = document.getElementById('graph-container');
            container.innerHTML = '';

            try {
                this.width = container.offsetWidth;
                this.height = container.offsetHeight || 600;
                
                this.svg = d3.select("#graph-container")
                    .append("svg")
                    .attr("width", this.width)
                    .attr("height", this.height)
                    .style("background-color", "#ffffff");

                this.zoom = d3.zoom()
                    .scaleExtent([0.1, 4])
                    .on("zoom", (event) => {
                        this.svg.select("g").attr("transform", event.transform);
                    });

                this.svg.call(this.zoom);
                this.svg = this.svg.append("g");

                this.loadGraph();
            } catch (error) {
                console.error('Error initializing graph:', error);
            }
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
            
            // Filter nodes based on namespace
            if (namespace === "") {
                // Show only top-level namespaces
                this.visibleNodes = this.allNodes.filter(node => node.level === 0);
            } else {
                // Show direct children of the selected namespace
                this.visibleNodes = this.allNodes.filter(node => {
                    if (node.id === namespace) return true;
                    if (!node.id.startsWith(namespace + ':')) return false;
                    const remainingPath = node.id.substring(namespace.length + 1);
                    return !remainingPath.includes(':');
                });
            }

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

            // Set up forces
            this.simulation = d3.forceSimulation(this.visibleNodes)
                .force("link", d3.forceLink(this.visibleLinks)
                    .id(d => d.id)
                    .distance(100))
                .force("charge", d3.forceManyBody()
                    .strength(-1000))
                .force("center", d3.forceCenter(this.width / 2, this.height / 2))
                .force("collide", d3.forceCollide()
                    .radius(50)
                    .strength(0.5));

            // Create links
            this.link = this.svg.append("g")
                .selectAll("line")
                .data(this.visibleLinks)
                .enter().append("line")
                .attr("stroke", "#999")
                .attr("stroke-opacity", 0.6)
                .attr("stroke-width", d => Math.sqrt(d.weight || 1));

            // Create node groups
            this.node = this.svg.append("g")
                .selectAll("g")
                .data(this.visibleNodes)
                .enter().append("g")
                .call(d3.drag()
                    .on("start", this.dragstarted.bind(this))
                    .on("drag", this.dragged.bind(this))
                    .on("end", this.dragended.bind(this)));

            // Add circles for nodes
            this.node.append("circle")
                .attr("r", d => this.hasChildren(d) ? 12 : 8)
                .style("fill", d => this.getNamespaceColor(d.id))
                .style("stroke", "#fff")
                .style("stroke-width", "2px")
                .style("cursor", "pointer");

            // Add text labels
            this.node.append("text")
                .attr("dx", 15)
                .attr("dy", 5)
                .text(d => d.name)
                .style("font-family", "Arial")
                .style("font-size", "12px")
                .style("pointer-events", "none");

            // Add invisible larger circle for better hit detection
            this.node.append("circle")
                .attr("r", 20)
                .style("opacity", 0)
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                    if (this.hasChildren(d)) {
                        this.showNamespace(d.id);
                    } else {
                        window.location.href = DOKU_BASE + 'doku.php?id=' + encodeURIComponent(d.id);
                    }
                });

            // Add navigation indicators
            this.node.filter(d => this.hasChildren(d))
                .append("text")
                .attr("text-anchor", "middle")
                .attr("dy", 5)
                .text("+")
                .style("font-size", "16px")
                .style("fill", "white")
                .style("pointer-events", "none");

            // Add back navigation if we're in a namespace
            if (this.currentNamespace) {
                const backButton = this.svg.append("g")
                    .attr("transform", `translate(40, 40)`)
                    .style("cursor", "pointer")
                    .on("click", () => {
                        const parentNamespace = this.currentNamespace.split(':').slice(0, -1).join(':');
                        this.showNamespace(parentNamespace);
                    });

                backButton.append("circle")
                    .attr("r", 15)
                    .style("fill", "#666");

                backButton.append("text")
                    .attr("text-anchor", "middle")
                    .attr("dy", 5)
                    .text("↩")
                    .style("fill", "white")
                    .style("font-size", "20px");
            }

            // Update simulation
            this.simulation.on("tick", () => {
                this.link
                    .attr("x1", d => d.source.x)
                    .attr("y1", d => d.source.y)
                    .attr("x2", d => d.target.x)
                    .attr("y2", d => d.target.y);

                this.node
                    .attr("transform", d => `translate(${d.x},${d.y})`);
            });
        },

        hasChildren: function(node) {
            return this.allNodes.some(n => 
                n.id.startsWith(node.id + ':') &&
                n.id.substring(node.id.length + 1).indexOf(':') === -1
            );
        },

        getNamespaceColor: function(id) {
            const colorScale = d3.scaleOrdinal(d3.schemeCategory10);
            return colorScale(id.split(':')[0]);
        },

        setupNamespaceFilter: function(namespaces) {
            const select = document.getElementById('namespace-filter');
            if (select && namespaces) {
                select.innerHTML = '<option value="">Show All Namespaces</option>';
                namespaces.forEach(ns => {
                    const option = document.createElement('option');
                    option.value = ns;
                    option.textContent = ns;
                    select.appendChild(option);
                });
            }
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