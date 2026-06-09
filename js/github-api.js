/* ============================================================
   github-api.js — GitHub API & raw content fetching layer
   All public repos, no auth required (rate limit: 60 req/hr).
   Includes sessionStorage caching with configurable TTL.
   ============================================================ */
(function () {
  const Dash = (window.Dashboard = window.Dashboard || {});
  const API = (Dash.api = {});

  const CACHE_PREFIX = "dash_cache_";
  const DEFAULT_TTL = 300_000; // 5 min

  /* ---- cache helpers ---- */
  function cacheGet(key) {
    try {
      const raw = sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.ts > (entry.ttl || DEFAULT_TTL)) {
        sessionStorage.removeItem(CACHE_PREFIX + key);
        return null;
      }
      return entry.data;
    } catch (_) {
      return null;
    }
  }
  function cacheSet(key, data, ttl) {
    try {
      sessionStorage.setItem(
        CACHE_PREFIX + key,
        JSON.stringify({ ts: Date.now(), ttl: ttl || DEFAULT_TTL, data })
      );
    } catch (_) { /* quota exceeded, ignore */ }
  }

  /* ---- URL builders ---- */
  API.getRawUrl = function (repo, path, branch) {
    branch = branch || "main";
    return "https://raw.githubusercontent.com/" + repo + "/" + branch + "/" + path;
  };
  API.getApiUrl = function (repo, endpoint) {
    return "https://api.github.com/repos/" + repo + endpoint;
  };

  /* ---- fetch with cache ---- */
  async function fetchJSON(url, ttl) {
    const key = url.replace(/[^a-zA-Z0-9]/g, "_");
    const cached = cacheGet(key);
    if (cached !== null) return cached;
    const resp = await fetch(url, { headers: { Accept: "application/vnd.github.v3+json" } });
    if (!resp.ok) {
      if (resp.status === 403) throw new Error("GitHub API rate limit exceeded. Try again later.");
      if (resp.status === 404) throw new Error("Resource not found: " + url);
      throw new Error("HTTP " + resp.status + " fetching " + url);
    }
    const data = await resp.json();
    cacheSet(key, data, ttl);
    return data;
  }

  async function fetchText(url, ttl) {
    const key = "txt_" + url.replace(/[^a-zA-Z0-9]/g, "_");
    const cached = cacheGet(key);
    if (cached !== null) return cached;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("HTTP " + resp.status + " fetching " + url);
    const data = await resp.text();
    cacheSet(key, data, ttl);
    return data;
  }

  /* ---- Audit Reports ---- */
  /** Fetch all audit-*.json files from audit repo reports/ directory */
  API.fetchAuditReports = async function () {
    const auditRepo = Dash.config.auditRepo;
    if (!auditRepo) throw new Error("auditRepo not configured");

    // List reports directory
    const listingUrl = API.getApiUrl(auditRepo, "/contents/reports");
    const files = await fetchJSON(listingUrl, 120_000); // 2 min TTL

    if (!Array.isArray(files)) throw new Error("Unexpected API response for reports listing");

    // Filter for audit-*.json and fetch each
    const reportFiles = files.filter(
      (f) => f.type === "file" && /^audit-.*\.json$/i.test(f.name)
    );

    if (reportFiles.length === 0) throw new Error("No audit reports found");

    const reports = await Promise.all(
      reportFiles.map(async (f) => {
        try {
          const data = await fetchJSON(f.download_url, 120_000);
          return { filename: f.name, ...data };
        } catch (e) {
          console.warn("Failed to fetch report", f.name, e);
          return null;
        }
      })
    );

    return reports.filter(Boolean);
  };

  /* ---- Search Index ---- */
  API.fetchSearchIndex = async function () {
    const auditRepo = Dash.config.auditRepo;
    if (!auditRepo) throw new Error("auditRepo not configured");
    const url = API.getRawUrl(auditRepo, "search-index.json");
    return fetchJSON(url, 300_000);
  };

  /* ---- Wiki Page ---- */
  API.fetchWikiPage = async function (path) {
    const wikiRepo = Dash.config.wikiRepo;
    if (!wikiRepo) throw new Error("wikiRepo not configured");
    // Paths may or may not have leading knowledge/wiki/
    const fullPath = path.startsWith("knowledge/wiki/") ? path : "knowledge/wiki/" + path;
    const url = API.getRawUrl(wikiRepo, fullPath);
    return fetchText(url, 180_000);
  };

  /* ---- CI Runs ---- */
  API.fetchCIRuns = async function () {
    const auditRepo = Dash.config.auditRepo;
    if (!auditRepo) throw new Error("auditRepo not configured");
    const url = API.getApiUrl(auditRepo, "/actions/runs?per_page=20");
    const data = await fetchJSON(url, 60_000);
    return (data && data.workflow_runs) ? data.workflow_runs : [];
  };

  /* ---- Wiki Directory Tree (from GitHub API) ---- */
  API.fetchWikiDirectory = async function () {
    const wikiRepo = Dash.config.wikiRepo;
    if (!wikiRepo) throw new Error("wikiRepo not configured");
    const url = API.getApiUrl(wikiRepo, "/contents/knowledge/wiki");
    const entries = await fetchJSON(url, 180_000);
    if (!Array.isArray(entries)) return [];

    // For each subdirectory, list its files
    const dirs = entries.filter((e) => e.type === "dir");
    const trees = await Promise.all(
      dirs.map(async (dir) => {
        try {
          const files = await fetchJSON(dir.url, 180_000);
          return {
            category: dir.name,
            pages: (files || []).filter((f) => f.type === "file" && f.name.endsWith(".md")),
          };
        } catch (e) {
          console.warn("Failed to list directory", dir.name, e);
          return { category: dir.name, pages: [] };
        }
      })
    );
    return trees;
  };

  /* ---- Clear cache ---- */
  API.clearCache = function () {
    const keys = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.startsWith(CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  };

  /* ---- Expose fetchJSON / fetchText for other modules ---- */
  API._fetchJSON = fetchJSON;
  API._fetchText = fetchText;
})();
