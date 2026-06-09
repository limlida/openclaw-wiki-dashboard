/* ============================================================
   wiki-view.js — Wiki browser: tree panel + markdown viewer
   Features: tree browser grouped by category, GFM markdown
   rendering, [[wikilink]] navigation, ^[source:...] citations,
   frontmatter parsing, source trace panel, search integration.
   ============================================================ */
(function () {
  var Dash = (window.Dashboard = window.Dashboard || {});
  var Wiki = (Dash.wiki = {});

  Wiki.currentPage = null;
  Wiki.currentPageData = null;

  /* ---- Main render ---- */
  Wiki.render = async function () {
    var container = document.getElementById("view-wiki");
    if (!container) return;

    // Build base layout
    container.innerHTML =
      '<div class="wiki-layout">' +
      '<div class="wiki-tree-panel" id="wiki-tree-panel">' +
      '<div class="loading-placeholder">Loading tree...</div>' +
      "</div>" +
      '<div class="wiki-viewer-panel" id="wiki-viewer-panel">' +
      renderWelcome() +
      "</div>" +
      "</div>";

    // Load tree
    try {
      await buildTree();
    } catch (e) {
      var treePanel = document.getElementById("wiki-tree-panel");
      if (treePanel) {
        treePanel.innerHTML =
          '<div class="error-placeholder">Tree load failed<br><button onclick="window.Dashboard.wiki.render()">Retry</button></div>';
      }
      console.error("Wiki tree build failed", e);
    }

    // If a page path was provided, load it
    if (Wiki.currentPage) {
      try {
        await loadPage(Wiki.currentPage);
      } catch (e) {
        console.error("Page load failed", e);
        var viewer = document.getElementById("wiki-viewer-panel");
        if (viewer) {
          viewer.innerHTML =
            '<div class="error-placeholder">Failed to load page<br><span style="font-size:.8rem">' +
            esc(e.message) +
            "</span></div>";
        }
      }
    }
  };

  /* ---- Welcome placeholder ---- */
  function renderWelcome() {
    return (
      '<div class="empty-placeholder">' +
      '<div class="empty-icon">📖</div>' +
      '<div class="empty-text">Select a page from the tree or use search to find content.</div>' +
      "</div>"
    );
  }

  /* ---- Tree Builder ---- */
  async function buildTree() {
    var panel = document.getElementById("wiki-tree-panel");
    if (!panel) return;

    // Prefer search index for tree data
    var entries = Dash.state.searchIndexEntries;

    if (!entries || entries.length === 0) {
      // Fallback: fetch directory listing from GitHub API
      try {
        var trees = await Dash.api.fetchWikiDirectory();
        entries = [];
        trees.forEach(function (t) {
          t.pages.forEach(function (p) {
            entries.push({
              path: "knowledge/wiki/" + t.category + "/" + p.name,
              title: p.name.replace(/\.md$/, "").replace(/[-_]/g, " "),
              type: t.category.replace(/s$/, ""),
              category: t.category,
            });
          });
        });
      } catch (e) {
        panel.innerHTML =
          '<div class="error-placeholder">Cannot load wiki tree<br><button onclick="window.Dashboard.wiki.render()">Retry</button></div>';
        return;
      }
    }

    // Group by category
    var groups = {};
    entries.forEach(function (e) {
      var cat = e.category || "other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(e);
    });

    // Sort categories: entities, concepts, sources, syntheses, then others
    var catOrder = ["entities", "concepts", "sources", "syntheses"];
    var sortedCats = Object.keys(groups).sort(function (a, b) {
      var ai = catOrder.indexOf(a),
        bi = catOrder.indexOf(b);
      if (ai === -1) ai = 999;
      if (bi === -1) bi = 999;
      return ai - bi;
    });

    // Category icons
    var icons = { entities: "🏷️", concepts: "💡", sources: "📄", syntheses: "🧩" };

    var html = "";
    sortedCats.forEach(function (cat) {
      var pages = groups[cat];
      pages.sort(function (a, b) {
        return (a.title || "").localeCompare(b.title || "");
      });
      var icon = icons[cat] || "📁";
      html +=
        '<div class="tree-node">' +
        '<div class="tree-category" data-cat="' +
        escAttr(cat) +
        '">' +
        icon +
        " " +
        esc(cat) +
        " (" +
        pages.length +
        ")" +
        "</div>" +
        '<div class="tree-cat-pages" data-cat="' +
        escAttr(cat) +
        '">';
      pages.forEach(function (p) {
        var activeClass = Wiki.currentPage === p.path ? " active" : "";
        html +=
          '<div class="tree-page' +
          activeClass +
          '" data-path="' +
          escAttr(p.path) +
          '" title="' +
          escAttr(p.title || p.path) +
          '">' +
          esc(p.title || p.path.replace(/.*\//, "").replace(/\.md$/, "")) +
          "</div>";
      });
      html += "</div></div>";
    });

    panel.innerHTML = html;

    // Attach click handlers
    panel.querySelectorAll(".tree-category").forEach(function (el) {
      el.addEventListener("click", function () {
        this.classList.toggle("collapsed");
        var cat = this.getAttribute("data-cat");
        var pagesEl = panel.querySelector('.tree-cat-pages[data-cat="' + escAttr(cat) + '"]');
        if (pagesEl) pagesEl.style.display = this.classList.contains("collapsed") ? "none" : "";
      });
    });

    panel.querySelectorAll(".tree-page").forEach(function (el) {
      el.addEventListener("click", function () {
        var path = this.getAttribute("data-path");
        if (path) {
          Wiki.currentPage = path;
          Dash.navigateTo("wiki", path);
        }
      });
    });
  }

  /* ---- Page Loader ---- */
  async function loadPage(path) {
    var viewer = document.getElementById("wiki-viewer-panel");
    if (!viewer) return;
    viewer.innerHTML =
      '<div class="loading-placeholder"><div class="spinner" style="margin:0 auto 12px;"></div>Loading page...</div>';

    try {
      var raw = await Dash.api.fetchWikiPage(path);
      Wiki.currentPageData = raw;
      renderPage(raw, path, viewer);
    } catch (e) {
      viewer.innerHTML =
        '<div class="error-placeholder">' +
        "<p>Failed to load page</p>" +
        '<p style="font-size:.8rem;color:var(--text-muted)">' +
        esc(e.message) +
        "</p>" +
        '<button onclick="window.Dashboard.wiki.reloadPage()">Retry</button>' +
        "</div>";
    }
  }

  Wiki.reloadPage = function () {
    if (Wiki.currentPage) {
      loadPage(Wiki.currentPage);
    }
  };

  /* ---- Page Renderer ---- */
  function renderPage(raw, path, viewer) {
    // Parse frontmatter
    var parsed = parseFrontmatter(raw);
    var meta = parsed.metadata;
    var body = parsed.body;

    // Build metadata bar
    var metaHtml = buildMetaBar(meta);

    // Render markdown
    var renderedHtml = renderMarkdown(body);

    // Build source trace panel
    var sourceHtml = buildSourceTrace(meta);

    viewer.innerHTML = metaHtml + '<div class="markdown-body">' + renderedHtml + "</div>" + sourceHtml;

    // Attach wikilink click handlers
    viewer.querySelectorAll("a.wikilink").forEach(function (link) {
      link.addEventListener("click", function (e) {
        e.preventDefault();
        var target = this.getAttribute("data-target-path");
        if (target) {
          Wiki.currentPage = target;
          Dash.navigateTo("wiki", target);
        }
      });
    });

    // Highlight current page in tree
    var treePanel = document.getElementById("wiki-tree-panel");
    if (treePanel) {
      treePanel.querySelectorAll(".tree-page").forEach(function (el) {
        el.classList.toggle("active", el.getAttribute("data-path") === path);
      });
    }
  }

  /* ---- Frontmatter Parser ---- */
  function parseFrontmatter(content) {
    var match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!match) return { metadata: {}, body: content };

    var frontmatter = match[1];
    var body = match[2];

    var meta = {};
    var lines = frontmatter.split(/\r?\n/);
    var currentKey = null;
    var currentArray = null;

    lines.forEach(function (line) {
      // Array item: "  - value"
      var arrMatch = line.match(/^\s+-\s+(.+)/);
      if (arrMatch && currentKey) {
        if (!meta[currentKey]) meta[currentKey] = [];
        meta[currentKey].push(arrMatch[1].trim());
        return;
      }
      // Key: value
      var kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*(.*)/);
      if (kvMatch) {
        var key = kvMatch[1];
        var value = kvMatch[2].trim();
        // Remove quotes
        value = value.replace(/^['"]|['"]$/g, "");
        meta[key] = value;
        currentKey = key;
      }
    });

    return { metadata: meta, body: body };
  }

  /* ---- Metadata Bar ---- */
  function buildMetaBar(meta) {
    var parts = [];
    if (meta.title) parts.push("<span>📝 " + esc(meta.title) + "</span>");
    if (meta.type) parts.push("<span>🏷️ " + esc(meta.type) + "</span>");
    if (meta.updated) parts.push("<span>🕐 " + esc(meta.updated) + "</span>");
    if (parts.length === 0) return "";
    return '<div class="page-meta">' + parts.join("") + "</div>";
  }

  /* ---- Source Trace Panel ---- */
  function buildSourceTrace(meta) {
    var sources = meta.sources;
    if (!sources) return "";

    // Normalise to array
    if (!Array.isArray(sources)) {
      if (typeof sources === "string") sources = [sources];
      else return "";
    }
    if (sources.length === 0) return "";

    var items = sources
      .map(function (s, i) {
        var text = String(s).trim();
        // Parse source:: file.md#L10-20 format
        var match = text.match(/^source::\s*(.+)/);
        var display = match ? match[1].trim() : text;
        return "<li>" + esc(display) + "</li>";
      })
      .join("");

    return (
      '<div class="source-trace">' +
      "<h4>📎 Source Trace (" +
      sources.length +
      ")</h4>" +
      '<ol class="source-trace-list">' +
      items +
      "</ol>" +
      "</div>"
    );
  }

  /* ---- Markdown Renderer ---- */
  function renderMarkdown(md) {
    // Step 1: Protect wikilinks [[page name]] → placeholder
    var wikilinks = [];
    md = md.replace(/\[\[([^\]]+)\]\]/g, function (match, title) {
      var idx = wikilinks.length;
      wikilinks.push(title.trim());
      return "WIKILINK_" + idx + "_PLH";
    });

    // Step 2: Protect citations ^[source:...] → placeholder
    var citations = [];
    md = md.replace(/\^\[source:\s*([^\]]+)\]/g, function (match, source) {
      var idx = citations.length;
      citations.push(source.trim());
      return "CITE_" + idx + "_PLH";
    });

    // Step 3: Render with marked (GFM)
    var html;
    try {
      html = marked.parse(md, { breaks: true, gfm: true });
    } catch (e) {
      html = "<p>Error rendering markdown</p>";
    }

    // Step 4: Restore wikilinks
    html = html.replace(/WIKILINK_(\d+)_PLH/g, function (match, idx) {
      var title = wikilinks[parseInt(idx, 10)];
      var slug = title
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");
      // Try to resolve path from search index
      var path = resolveWikilinkPath(title);
      return (
        '<a href="#/wiki/' +
        encodeURIComponent(path || slug) +
        '" class="wikilink" data-target-path="' +
        escAttr(path || "") +
        '" data-title="' +
        escAttr(title) +
        '">' +
        esc(title) +
        "</a>"
      );
    });

    // Step 5: Restore citations
    html = html.replace(/CITE_(\d+)_PLH/g, function (match, idx) {
      var source = citations[parseInt(idx, 10)];
      return '<sup class="citation" title="' + escAttr(source) + '"><a href="#source-ref">📎</a></sup>';
    });

    return html;
  }

  /* ---- Resolve wikilink title to path ---- */
  function resolveWikilinkPath(title) {
    var entries = Dash.state.searchIndexEntries;
    if (!entries) return null;
    var lower = title.toLowerCase().replace(/\s+/g, "-");
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var eTitle = (e.title || "").toLowerCase().replace(/\s+/g, "-");
      if (eTitle === lower) return e.path;
    }
    // Try partial match
    for (var j = 0; j < entries.length; j++) {
      var ej = entries[j];
      var ejTitle = (ej.title || "").toLowerCase();
      if (ejTitle.indexOf(title.toLowerCase()) !== -1) return ej.path;
    }
    return null;
  }

  /* ---- Helpers ---- */
  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }
})();
