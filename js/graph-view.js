/* ============================================================
   graph-view.js — Knowledge graph (D3.js force-directed)
   Nodes = wiki pages (colored by type, sized by ref count)
   Edges = wikilinks
   Hover: highlight neighbors + tooltip
   Click: navigate to wiki page
   ============================================================ */
(function () {
  var Dash = (window.Dashboard = window.Dashboard || {});
  var Graph = (Dash.graph = {});

  var simulation = null;
  var svg = null;
  var g = null;

  var typeColors = {
    entity: "#4a6cf7",
    entities: "#4a6cf7",
    concept: "#10b981",
    concepts: "#10b981",
    source: "#f59e0b",
    sources: "#f59e0b",
    synthesis: "#8b5cf6",
    syntheses: "#8b5cf6",
  };
  var defaultColor = "#94a3b8";

  Graph.render = async function () {
    var container = document.getElementById("view-graph");
    if (!container) return;

    container.innerHTML =
      '<div class="loading-placeholder">' +
      '<div class="spinner" style="margin:0 auto 12px;"></div>Building graph...</div>';

    try {
      var entries = Dash.state.searchIndexEntries;
      if (!entries || entries.length === 0) {
        entries = await Dash.api.fetchSearchIndex();
        if (entries && Array.isArray(entries)) {
          Dash.search.build(entries);
          Dash.state.searchIndexEntries = entries;
        }
      }

      if (!entries || entries.length === 0) {
        container.innerHTML =
          '<div class="empty-placeholder"><div class="empty-icon">🕸</div><div class="empty-text">No wiki data to graph.<br>Generate a search index first.</div></div>';
        return;
      }

      var graphData = buildGraphData(entries);
      container.innerHTML =
        '<div id="graph-container">' +
        '<div class="graph-legend" id="graph-legend"></div>' +
        '<div class="graph-tooltip" id="graph-tooltip"></div>' +
        "</div>";

      drawGraph(graphData);
    } catch (e) {
      console.error("Graph render error", e);
      container.innerHTML =
        '<div class="error-placeholder">Failed to build graph<br><span style="font-size:.8rem">' +
        esc(e.message) +
        '</span><br><button onclick="window.Dashboard.graph.render()">Retry</button></div>';
    }
  };

  /* ---- Build Graph Data ---- */
  function buildGraphData(entries) {
    var nodeMap = {};
    var nodes = [];
    var linkSet = {};
    var links = [];

    // Build nodes
    entries.forEach(function (e, i) {
      var id = e.path || "node_" + i;
      nodeMap[id] = {
        id: id,
        title: e.title || id.replace(/.*\//, "").replace(/\.md$/, ""),
        type: e.type || "unknown",
        path: e.path,
        refCount: 0,
      };
      nodes.push(nodeMap[id]);
    });

    // Build edges from wikilinks
    entries.forEach(function (e) {
      var sourceId = e.path;
      if (!sourceId || !nodeMap[sourceId]) return;
      var wls = e.wikilinks || [];
      if (!Array.isArray(wls)) return;
      wls.forEach(function (wl) {
        var targetTitle = typeof wl === "string" ? wl : wl.target || wl.title || "";
        if (!targetTitle) return;
        // Find target node by title
        var targetNode = findNodeByTitle(nodes, targetTitle);
        if (!targetNode) return;
        var targetId = targetNode.id;
        if (sourceId === targetId) return;
        var key = [sourceId, targetId].sort().join("|||");
        if (!linkSet[key]) {
          linkSet[key] = true;
          links.push({ source: sourceId, target: targetId });
          targetNode.refCount++;
        }
      });
    });

    // Filter: only include nodes with at least one connection (or keep all if small)
    if (nodes.length > 30) {
      var connectedIds = {};
      links.forEach(function (l) {
        connectedIds[typeof l.source === "object" ? l.source.id : l.source] = true;
        connectedIds[typeof l.target === "object" ? l.target.id : l.target] = true;
      });
      nodes = nodes.filter(function (n) {
        return connectedIds[n.id];
      });
    }

    return { nodes: nodes, links: links };
  }

  function findNodeByTitle(nodes, title) {
    var lower = title.toLowerCase().replace(/\s+/g, "-");
    for (var i = 0; i < nodes.length; i++) {
      var nodeTitle = nodes[i].title.toLowerCase().replace(/\s+/g, "-");
      if (nodeTitle === lower) return nodes[i];
    }
    // Partial match
    for (var j = 0; j < nodes.length; j++) {
      var nt = nodes[j].title.toLowerCase();
      if (nt.indexOf(title.toLowerCase()) !== -1) return nodes[j];
    }
    return null;
  }

  /* ---- Draw ---- */
  function drawGraph(data) {
    var container = document.getElementById("graph-container");
    if (!container) return;

    // Clean up previous
    if (simulation) simulation.stop();
    container.querySelector("svg")?.remove();

    var width = container.clientWidth;
    var height = container.clientHeight;

    svg = d3
      .select("#graph-container")
      .append("svg")
      .attr("width", width)
      .attr("height", height);

    // Zoom
    var zoom = d3.zoom().scaleExtent([0.2, 5]).on("zoom", function (event) {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);

    g = svg.append("g");

    // Tooltip
    var tooltip = d3.select("#graph-tooltip");

    // Scale for node radius based on refCount
    var maxRef = d3.max(data.nodes, function (d) { return d.refCount; }) || 1;
    var radiusScale = d3.scaleSqrt().domain([0, maxRef]).range([6, 22]);

    // Color scale
    function color(d) {
      return typeColors[d.type] || defaultColor;
    }

    // Simulation
    simulation = d3
      .forceSimulation(data.nodes)
      .force(
        "link",
        d3
          .forceLink(data.links)
          .id(function (d) { return d.id; })
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(function (d) { return radiusScale(d.refCount) + 4; }));

    // Links
    var link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(data.links)
      .join("line")
      .attr("stroke", "#cbd5e1")
      .attr("stroke-width", 1.2)
      .attr("stroke-opacity", 0.6);

    // Nodes
    var node = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("circle")
      .data(data.nodes)
      .join("circle")
      .attr("r", function (d) { return radiusScale(d.refCount); })
      .attr("fill", color)
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .attr("cursor", "pointer")
      .call(
        d3
          .drag()
          .on("start", function (event, d) {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", function (event, d) {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", function (event, d) {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    // Labels
    var label = g
      .append("g")
      .attr("class", "labels")
      .selectAll("text")
      .data(data.nodes)
      .join("text")
      .text(function (d) { return d.title.length > 20 ? d.title.slice(0, 18) + "…" : d.title; })
      .attr("font-size", "10px")
      .attr("fill", "#475569")
      .attr("text-anchor", "middle")
      .attr("dy", function (d) { return -radiusScale(d.refCount) - 4; })
      .style("pointer-events", "none");

    // Hover interactions
    node
      .on("mouseover", function (event, d) {
        // Highlight neighbors
        var connectedIds = new Set();
        data.links.forEach(function (l) {
          var sid = typeof l.source === "object" ? l.source.id : l.source;
          var tid = typeof l.target === "object" ? l.target.id : l.target;
          if (sid === d.id) connectedIds.add(tid);
          if (tid === d.id) connectedIds.add(sid);
        });

        node.attr("opacity", function (n) {
          return n.id === d.id || connectedIds.has(n.id) ? 1 : 0.15;
        });
        link.attr("stroke-opacity", function (l) {
          var sid = typeof l.source === "object" ? l.source.id : l.source;
          var tid = typeof l.target === "object" ? l.target.id : l.target;
          return sid === d.id || tid === d.id ? 1 : 0.05;
        });
        label.attr("opacity", function (n) {
          return n.id === d.id || connectedIds.has(n.id) ? 1 : 0.15;
        });

        tooltip.style("opacity", 1).text(d.title + " [" + d.type + "]");
      })
      .on("mousemove", function (event) {
        tooltip.style("left", event.pageX + 12 + "px").style("top", event.pageY - 10 + "px");
      })
      .on("mouseout", function () {
        node.attr("opacity", 1);
        link.attr("stroke-opacity", 0.6);
        label.attr("opacity", 1);
        tooltip.style("opacity", 0);
      })
      .on("click", function (event, d) {
        if (d.path) {
          Wiki_navigate(d.path);
        }
      });

    // Tick
    simulation.on("tick", function () {
      link
        .attr("x1", function (d) { return d.source.x; })
        .attr("y1", function (d) { return d.source.y; })
        .attr("x2", function (d) { return d.target.x; })
        .attr("y2", function (d) { return d.target.y; });

      node.attr("cx", function (d) { return d.x; }).attr("cy", function (d) { return d.y; });

      label.attr("x", function (d) { return d.x; }).attr("y", function (d) { return d.y; });
    });

    // Legend
    renderLegend();

    // Resize handler
    window.addEventListener("resize", function () {
      var w = container.clientWidth;
      var h = container.clientHeight;
      if (svg) {
        svg.attr("width", w).attr("height", h);
        simulation.force("center", d3.forceCenter(w / 2, h / 2));
        simulation.alpha(0.3).restart();
      }
    });
  }

  /* ---- Legend ---- */
  function renderLegend() {
    var legendEl = document.getElementById("graph-legend");
    if (!legendEl) return;
    var items = [
      { label: "Entity", color: typeColors.entity },
      { label: "Concept", color: typeColors.concept },
      { label: "Source", color: typeColors.source },
      { label: "Synthesis", color: typeColors.synthesis },
    ];
    legendEl.innerHTML = items
      .map(function (item) {
        return (
          '<div class="graph-legend-item">' +
          '<span class="graph-legend-dot" style="background:' +
          item.color +
          '"></span>' +
          esc(item.label) +
          "</div>"
        );
      })
      .join("");
  }

  /* ---- Navigate from graph to wiki ---- */
  function Wiki_navigate(path) {
    // Access wiki module via Dashboard
    if (Dash.wiki) Dash.wiki.currentPage = path;
    Dash.navigateTo("wiki", path);
  }

  /* ---- Helpers ---- */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
