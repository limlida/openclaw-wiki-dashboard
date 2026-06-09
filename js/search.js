/* ============================================================
   search.js — Full-text search powered by flexsearch
   Loads search-index.json (array of {path, title, type, content, ...})
   into a FlexSearch index for instant client-side search.
   ============================================================ */
(function () {
  const Dash = (window.Dashboard = window.Dashboard || {});
  const Search = (Dash.search = {});

  let index = null;       // FlexSearch instance
  let pageMap = {};       // id → page entry
  let ready = false;

  /* ---- Build index from entries ---- */
  Search.build = function (entries) {
    if (!entries || !Array.isArray(entries)) {
      console.warn("search.build: invalid entries");
      return;
    }
    // FlexSearch Index with reasonable options
    index = new FlexSearch.Index({
      tokenize: "forward",
      cache: true,
      charset: "latin:extra",
    });

    pageMap = {};
    entries.forEach(function (entry, i) {
      var id = String(i);
      pageMap[id] = entry;
      // Index title (high weight) + content
      var doc = (entry.title || "") + " " + (entry.content || "") + " " + (entry.type || "") + " " + (entry.category || "");
      index.add(id, doc);
    });

    ready = true;
    console.log("Search index ready: " + entries.length + " pages indexed");
  };

  /* ---- Query ---- */
  Search.query = function (q, limit) {
    limit = limit || 15;
    if (!ready || !index) return [];
    if (!q || !q.trim()) return [];
    var ids = index.search(q, { limit: limit });
    return ids.map(function (id) { return pageMap[id]; }).filter(Boolean);
  };

  /* ---- Render results dropdown ---- */
  Search.renderResults = function (results, container) {
    if (!container) return;
    if (!results || results.length === 0) {
      container.innerHTML = '<div class="search-result-item" style="color:var(--text-muted);cursor:default;">No results</div>';
      container.classList.add("show");
      return;
    }
    var html = "";
    results.forEach(function (r) {
      var title = esc(r.title || "Untitled");
      var path = esc(r.path || "");
      var type = esc(r.type || "");
      html +=
        '<div class="search-result-item" data-path="' +
        escAttr(r.path || "") +
        '" data-title="' +
        escAttr(r.title || "") +
        '">' +
        '<div class="result-title">' + title + ' <span style="font-size:.7rem;color:var(--text-muted)">[' + type + ']</span></div>' +
        '<div class="result-path">' + path + "</div>" +
        "</div>";
    });
    container.innerHTML = html;
    container.classList.add("show");
  };

  Search.isReady = function () {
    return ready;
  };

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
