/* ============================================================
   app.js — Main application orchestrator
   - Loads config.json
   - Initialises sidebar navigation
   - Routes between audit / wiki / graph views
   - Loads search index on startup
   ============================================================ */
(function () {
  var Dash = (window.Dashboard = window.Dashboard || {});

  /* ---- State ---- */
  Dash.state = {
    currentView: "audit",
    currentWikiPage: null,
    searchIndexLoaded: false,
    auditData: null,
    ciRuns: null,
  };

  /* ---- Init ---- */
  async function init() {
    try {
      // Load config
      var configResp = await fetch("config.json");
      if (!configResp.ok) throw new Error("Failed to load config.json");
      Dash.config = await configResp.json();
    } catch (e) {
      console.error("Config load failed, using defaults", e);
      Dash.config = {
        wikiRepo: "limlida/SongWiki",
        auditRepo: "limlida/openclaw-wiki-auditor",
        refreshIntervalSec: 300,
        trendWeeks: 12,
      };
    }

    // Init sidebar
    initSidebar();

    // Route from hash or default
    handleRoute();

    // Listen for hash changes
    window.addEventListener("hashchange", handleRoute);

    // Load search index in background
    loadSearchIndex();
  }

  /* ---- Sidebar ---- */
  function initSidebar() {
    var buttons = document.querySelectorAll("#sidebar .nav-btn");
    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var view = this.getAttribute("data-view");
        if (view) {
          window.location.hash = "#/" + view;
        }
      });
    });
  }

  /* ---- Routing ---- */
  function handleRoute() {
    var hash = window.location.hash || "#/audit";
    // Parse: #/audit , #/wiki , #/wiki/path/to/page , #/graph
    var parts = hash.replace(/^#\//, "").split("/");
    var view = parts[0] || "audit";
    var subPath = parts.slice(1).join("/");

    // Validate view
    if (["audit", "wiki", "graph"].indexOf(view) === -1) {
      view = "audit";
    }

    switchView(view, subPath || null);
  }

  function switchView(name, param) {
    Dash.state.currentView = name;

    // Update sidebar active
    document.querySelectorAll("#sidebar .nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.getAttribute("data-view") === name);
    });

    // Show/hide views
    document.querySelectorAll(".view").forEach(function (v) {
      v.classList.remove("active");
    });

    var viewEl = document.getElementById("view-" + name);
    if (viewEl) viewEl.classList.add("active");

    // Hide alert banner by default
    var banner = document.getElementById("alert-banner");
    if (banner) banner.classList.remove("show");

    // Render
    if (name === "audit") {
      if (Dash.audit && Dash.audit.render) Dash.audit.render();
    } else if (name === "wiki") {
      if (Dash.wiki) {
        Dash.wiki.currentPage = param || null;
        Dash.wiki.render();
      }
    } else if (name === "graph") {
      if (Dash.graph && Dash.graph.render) Dash.graph.render();
    }
  }

  /* ---- Load search index ---- */
  async function loadSearchIndex() {
    try {
      showLoading(true);
      var entries = await Dash.api.fetchSearchIndex();
      if (entries && Array.isArray(entries)) {
        Dash.search.build(entries);
        Dash.state.searchIndexLoaded = true;
        Dash.state.searchIndexEntries = entries;
      }
    } catch (e) {
      console.warn("Search index load failed", e);
      // Continue without search - wiki tree falls back to directory listing
    } finally {
      showLoading(false);
    }
  }

  /* ---- Loading overlay ---- */
  Dash.showLoading = showLoading;
  function showLoading(on) {
    var el = document.getElementById("loading-overlay");
    if (el) el.classList.toggle("show", on);
  }

  /* ---- Navigate (exposed for other modules) ---- */
  Dash.navigateTo = function (view, param) {
    var hash = "#/" + view;
    if (param) hash += "/" + param;
    window.location.hash = hash;
  };

  /* ---- Alert banner ---- */
  Dash.showAlert = function (msg) {
    var banner = document.getElementById("alert-banner");
    if (!banner) return;
    var textEl = banner.querySelector(".alert-text");
    if (textEl) textEl.textContent = msg;
    banner.classList.add("show");
  };
  Dash.hideAlert = function () {
    var banner = document.getElementById("alert-banner");
    if (banner) banner.classList.remove("show");
  };

  // Alert close button
  document.addEventListener("DOMContentLoaded", function () {
    var closeBtn = document.querySelector("#alert-banner .alert-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        Dash.hideAlert();
      });
    }

    // Search results click delegation
    document.addEventListener("click", function (e) {
      var item = e.target.closest(".search-result-item");
      if (item) {
        var path = item.getAttribute("data-path");
        if (path) {
          Dash.navigateTo("wiki", path);
          // Hide search results
          var resultsEl = document.getElementById("search-results");
          if (resultsEl) resultsEl.classList.remove("show");
        }
      }
    });

    // Search input typing
    var searchInput = document.getElementById("search-input");
    var searchResults = document.getElementById("search-results");
    if (searchInput && searchResults) {
      var debounceTimer;
      searchInput.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        var q = this.value.trim();
        if (!q) {
          searchResults.classList.remove("show");
          return;
        }
        debounceTimer = setTimeout(function () {
          var results = Dash.search.query(q, 12);
          Dash.search.renderResults(results, searchResults);
        }, 200);
      });
      // Hide on blur (delayed to allow click)
      searchInput.addEventListener("blur", function () {
        setTimeout(function () {
          searchResults.classList.remove("show");
        }, 150);
      });
      searchInput.addEventListener("focus", function () {
        var q = this.value.trim();
        if (q && Dash.search.isReady()) {
          var results = Dash.search.query(q, 12);
          Dash.search.renderResults(results, searchResults);
        }
      });
    }
  });

  /* ---- Boot ---- */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
