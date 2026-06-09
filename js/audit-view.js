/* ============================================================
   audit-view.js — Audit panel: overview cards, CI history,
   trend charts (Chart.js), detail tables, alert banner.
   ============================================================ */
(function () {
  var Dash = (window.Dashboard = window.Dashboard || {});
  var Audit = (Dash.audit = {});

  var trendsChart = null;

  /* ---- Main render entry ---- */
  Audit.render = async function () {
    var container = document.getElementById("view-audit");
    if (!container) return;
    container.innerHTML =
      '<div class="loading-placeholder"><div class="spinner" style="margin:0 auto 12px;"></div>Loading audit data...</div>';

    try {
      var reports = await Dash.api.fetchAuditReports();
      var ciRuns = await Dash.api.fetchCIRuns();

      Dash.state.auditData = reports;
      Dash.state.ciRuns = ciRuns;

      if (!reports || reports.length === 0) {
        container.innerHTML = renderEmpty();
        return;
      }

      // Sort reports by timestamp descending
      reports.sort(function (a, b) {
        return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
      });

      var latest = reports[0];
      var html = "";

      // Overview cards
      html += renderOverviewCards(latest, ciRuns);

      // Trend chart
      html += renderTrendChartSection(reports);

      // CI pipeline table
      html += renderCITable(ciRuns);

      // Detail tables
      html += renderDetailTables(latest);

      // Findings table
      if (latest.findings && latest.findings.length > 0) {
        html += renderFindingsTable(latest.findings);
      }

      container.innerHTML = html;

      // Draw chart after DOM update
      setTimeout(function () {
        drawTrendChart(reports);
      }, 50);

      // Check for decline alert
      checkDecline(reports);
    } catch (e) {
      console.error("Audit render error", e);
      container.innerHTML = renderError(e.message);
    }
  };

  /* ---- Overview Cards ---- */
  function renderOverviewCards(latest, ciRuns) {
    var l1 = latest.l1_compliance || latest.l1 || {};
    var l2 = latest.l2_fidelity || latest.l2 || {};
    var l3 = latest.l3_coverage || latest.l3 || {};
    var ciStatus = ciRuns && ciRuns.length > 0 ? ciRuns[0].conclusion : "unknown";

    var l1Score = l1.score != null ? (l1.score * 100).toFixed(1) : (l1.percentage != null ? l1.percentage.toFixed(1) : "--");
    var l2Score = l2.score != null ? (l2.score * 100).toFixed(1) : (l2.average != null ? l2.average.toFixed(1) : "--");
    var l3Score = l3.score != null ? (l3.score * 100).toFixed(1) : (l3.percentage != null ? l3.percentage.toFixed(1) : "--");

    var l1Color = parseFloat(l1Score) >= 90 ? "green" : parseFloat(l1Score) >= 70 ? "amber" : "red";
    var l2Color = parseFloat(l2Score) >= 80 ? "green" : parseFloat(l2Score) >= 60 ? "amber" : "red";
    var l3Color = parseFloat(l3Score) >= 70 ? "green" : parseFloat(l3Score) >= 50 ? "amber" : "red";

    var ciLabel = ciStatus === "success" ? "Pass" : ciStatus === "failure" ? "Fail" : ciStatus === "cancelled" ? "Cancelled" : "N/A";
    var ciBadge = ciStatus === "success" ? "pass" : ciStatus === "failure" ? "fail" : ciStatus === "cancelled" ? "warn" : "neutral";

    return (
      '<div class="card-grid">' +
      card("L1 Compliance", l1Score + "%", l1Color, (l1.passed || l1.total ? (l1.passed || 0) + " / " + (l1.total || 0) + " checks passed" : "")) +
      card("L2 Fidelity", l2Score + "%", l2Color, renderL2Sub(l2)) +
      card("L3 Coverage", l3Score + "%", l3Color, (l3.covered != null ? l3.covered + " / " + (l3.total || "?") + " items" : "")) +
      card("CI Status", '<span class="badge ' + ciBadge + '">' + ciLabel + "</span>", "", ciRuns && ciRuns.length > 0 ? "Last run: " + formatDate(ciRuns[0].created_at) : "") +
      "</div>"
    );
  }

  function renderL2Sub(l2) {
    if (l2.details && Array.isArray(l2.details)) {
      var avg = l2.score != null ? (l2.score * 100).toFixed(0) : "?";
      return l2.details.length + " detail metrics, avg " + avg + "%";
    }
    return "";
  }

  function card(title, value, colorClass, sub) {
    return (
      '<div class="card">' +
      '<div class="card-header">' + esc(title) + "</div>" +
      '<div class="card-value ' + colorClass + '">' + value + "</div>" +
      (sub ? '<div class="card-sub">' + esc(sub) + "</div>" : "") +
      "</div>"
    );
  }

  /* ---- Trend Chart ---- */
  function renderTrendChartSection(reports) {
    return (
      '<div class="chart-container">' +
      '<div class="chart-title">📈 Trend Curves (L2 Fidelity & L3 Coverage)</div>' +
      '<canvas id="trend-chart"></canvas>' +
      "</div>"
    );
  }

  function drawTrendChart(reports) {
    var canvas = document.getElementById("trend-chart");
    if (!canvas) return;
    if (trendsChart) trendsChart.destroy();

    var ctx = canvas.getContext("2d");

    // Build data series from reports (reports already sorted desc, reverse for chart)
    var sorted = reports.slice().reverse();
    var labels = sorted.map(function (r) {
      return formatDateShort(r.timestamp || r.date || "");
    });
    var l2Data = sorted.map(function (r) {
      var l2 = r.l2_fidelity || r.l2 || {};
      return l2.score != null ? parseFloat((l2.score * 100).toFixed(1)) : null;
    });
    var l3Data = sorted.map(function (r) {
      var l3 = r.l3_coverage || r.l3 || {};
      return l3.score != null ? parseFloat((l3.score * 100).toFixed(1)) : null;
    });

    trendsChart = new Chart(ctx, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "L2 Fidelity (%)",
            data: l2Data,
            borderColor: "#4a6cf7",
            backgroundColor: "rgba(74,108,247,0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
          {
            label: "L3 Coverage (%)",
            data: l3Data,
            borderColor: "#10b981",
            backgroundColor: "rgba(16,185,129,0.08)",
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointHoverRadius: 6,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
        },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: function (v) { return v + "%"; } } },
        },
        interaction: { intersect: false, mode: "index" },
      },
    });
  }

  /* ---- CI Pipeline Table ---- */
  function renderCITable(runs) {
    if (!runs || runs.length === 0) {
      return '<div class="empty-placeholder"><div class="empty-icon">🔄</div><div class="empty-text">No CI runs found</div></div>';
    }
    var rows = runs
      .slice(0, 15)
      .map(function (r) {
        var statusIcon = r.conclusion === "success" ? "✅" : r.conclusion === "failure" ? "❌" : r.conclusion === "cancelled" ? "⚠️" : "⏳";
        var duration = r.updated_at && r.created_at ? formatDuration(r.created_at, r.updated_at) : "--";
        var logUrl = r.html_url || "#";
        return (
          "<tr>" +
          "<td>" + (r.run_number || "--") + "</td>" +
          "<td>" + statusIcon + " " + esc(r.conclusion || r.status || "--") + "</td>" +
          "<td>" + esc(duration) + "</td>" +
          "<td>" + esc(formatDate(r.created_at)) + "</td>" +
          '<td><a href="' + escAttr(logUrl) + '" target="_blank" rel="noopener">Logs →</a></td>' +
          "</tr>"
        );
      })
      .join("");

    return (
      '<div class="subsection-title">🔄 CI Pipeline History</div>' +
      '<table class="data-table"><thead><tr>' +
      "<th>Run #</th><th>Status</th><th>Duration</th><th>Date</th><th>Logs</th>" +
      "</tr></thead><tbody>" +
      rows +
      "</tbody></table>"
    );
  }

  /* ---- Detail Tables (collapsible) ---- */
  function renderDetailTables(latest) {
    var html = '<div class="subsection-title">📋 Latest Audit Details</div>';

    // L1 details
    var l1 = latest.l1_compliance || latest.l1 || {};
    if (l1.details && Array.isArray(l1.details)) {
      html += collapsibleSection("L1 Compliance Checks", renderCheckTable(l1.details));
    }

    // L2 details
    var l2 = latest.l2_fidelity || latest.l2 || {};
    if (l2.details && Array.isArray(l2.details)) {
      html += collapsibleSection("L2 Fidelity Metrics", renderMetricTable(l2.details));
    }

    // L3 details
    var l3 = latest.l3_coverage || latest.l3 || {};
    if (l3.details && Array.isArray(l3.details)) {
      html += collapsibleSection("L3 Coverage Items", renderCoverageTable(l3.details));
    }

    return html;
  }

  function renderCheckTable(details) {
    var rows = details
      .map(function (d) {
        var status = d.status === "pass" || d.passed ? "✅" : "❌";
        return "<tr><td>" + status + "</td><td>" + esc(d.name || d.check || "--") + "</td><td>" + esc(d.message || d.detail || "") + "</td></tr>";
      })
      .join("");
    return '<table class="data-table"><thead><tr><th></th><th>Check</th><th>Detail</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  function renderMetricTable(details) {
    var rows = details
      .map(function (d) {
        var score = d.score != null ? (d.score * 100).toFixed(1) + "%" : "--";
        return "<tr><td>" + esc(d.name || d.metric || "--") + "</td><td>" + score + "</td><td>" + esc(d.comment || d.note || "") + "</td></tr>";
      })
      .join("");
    return '<table class="data-table"><thead><tr><th>Metric</th><th>Score</th><th>Note</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  function renderCoverageTable(details) {
    var rows = details
      .map(function (d) {
        var covered = d.covered ? "✅" : "❌";
        return "<tr><td>" + covered + "</td><td>" + esc(d.name || d.item || "--") + "</td></tr>";
      })
      .join("");
    return '<table class="data-table"><thead><tr><th></th><th>Item</th></tr></thead><tbody>' + rows + "</tbody></table>";
  }

  /* ---- Findings Table ---- */
  function renderFindingsTable(findings) {
    var rows = findings
      .map(function (f) {
        var severityBadge =
          f.severity === "high"
            ? '<span class="badge fail">High</span>'
            : f.severity === "medium"
            ? '<span class="badge warn">Medium</span>'
            : '<span class="badge neutral">Low</span>';
        return "<tr><td>" + severityBadge + "</td><td>" + esc(f.file || f.path || "--") + "</td><td>" + esc(f.message || f.description || "--") + "</td></tr>";
      })
      .join("");
    return (
      '<div class="subsection-title">🔍 Findings</div>' +
      '<table class="data-table"><thead><tr><th>Severity</th><th>File</th><th>Description</th></tr></thead><tbody>' +
      rows +
      "</tbody></table>"
    );
  }

  /* ---- Collapsible ---- */
  function collapsibleSection(title, body) {
    var id = "collapsible-" + Math.random().toString(36).slice(2, 8);
    return (
      '<div class="collapsible-header" data-target="' +
      id +
      '">' +
      esc(title) +
      "</div>" +
      '<div class="collapsible-body" id="' +
      id +
      '">' +
      body +
      "</div>"
    );
  }

  // Delegate collapsible clicks
  document.addEventListener("click", function (e) {
    var header = e.target.closest(".collapsible-header");
    if (!header) return;
    var targetId = header.getAttribute("data-target");
    var body = document.getElementById(targetId);
    if (body) {
      header.classList.toggle("open");
      body.classList.toggle("open");
    }
  });

  /* ---- Decline Detection ---- */
  function checkDecline(reports) {
    if (!reports || reports.length < 4) return;
    var sorted = reports.slice().sort(function (a, b) {
      return new Date(b.timestamp || 0) - new Date(a.timestamp || 0);
    });
    var recent = sorted.slice(0, 4); // last 4 reports

    function getScore(r, key) {
      var obj = r[key + "_fidelity"] || r[key + "_compliance"] || r[key + "_coverage"] || r[key] || {};
      return obj.score != null ? obj.score : obj.percentage ? obj.percentage / 100 : null;
    }

    // Check L2 decline across last 3 vs 4th
    var l2Vals = recent.map(function (r) { return getScore(r, "l2"); }).filter(function (v) { return v != null; });
    var l3Vals = recent.map(function (r) { return getScore(r, "l3"); }).filter(function (v) { return v != null; });

    var declined = false;
    if (l2Vals.length >= 4) {
      if (l2Vals[0] < l2Vals[3]) declined = true;
    }
    if (!declined && l3Vals.length >= 4) {
      if (l3Vals[0] < l3Vals[3]) declined = true;
    }

    if (declined) {
      Dash.showAlert("⚠️ Trend decline detected in recent audit reports. Scores are trending downward.");
    } else {
      Dash.hideAlert();
    }
  }

  /* ---- Placeholders ---- */
  function renderEmpty() {
    return '<div class="empty-placeholder"><div class="empty-icon">📊</div><div class="empty-text">No audit reports available yet.<br>Run the auditor to generate your first report.</div></div>';
  }

  function renderError(msg) {
    return (
      '<div class="error-placeholder">' +
      "<p>Failed to load audit data</p>" +
      "<p style='font-size:.8rem;color:var(--text-muted);'>" +
      esc(msg) +
      "</p>" +
      '<button onclick="window.Dashboard.audit.render()">Retry</button>' +
      "</div>"
    );
  }

  /* ---- Helpers ---- */
  function formatDate(d) {
    if (!d) return "--";
    try {
      return new Date(d).toLocaleString();
    } catch (_) {
      return d;
    }
  }
  function formatDateShort(d) {
    if (!d) return "--";
    try {
      return new Date(d).toLocaleDateString();
    } catch (_) {
      return d;
    }
  }
  function formatDuration(start, end) {
    try {
      var ms = new Date(end) - new Date(start);
      if (ms < 1000) return "<1s";
      if (ms < 60000) return Math.round(ms / 1000) + "s";
      return Math.round(ms / 60000) + "m " + Math.round((ms % 60000) / 1000) + "s";
    } catch (_) {
      return "--";
    }
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function escAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  }
})();
