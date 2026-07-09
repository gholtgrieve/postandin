import { RINKS } from '/lib/rinks.js';
import {
  escapeHtml, safeUrl, fmtTime, fmtDuration, dayKey, fmtDayLabel,
  mkSessionKey, GOING_PERSON_SVG
} from '/stick-and-puck/modules/utils.js';
import { GROUPS_ENABLED, getGroups } from '/stick-and-puck/modules/storage.js';
import {
  allData, setAllData, activeFilter, setActiveFilter,
  selectedRinks, sessionMap
} from '/stick-and-puck/modules/state.js';
import { updateGoingIndicators } from '/stick-and-puck/modules/rsvp.js';

// ─── Inline fetcher (browser-safe ES module) ──────────────────────────────────

// Aggregate ────────────────────────────────────────────────────────────────────
async function fetchAll() {
  const r = await fetch('/api/schedule');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const raw = await r.json();
  const now = new Date();
  const results = {};
  for (const [key, val] of Object.entries(raw)) {
    results[key] = {
      ok: val.ok,
      rink: RINKS[key],
      sessions: (val.sessions ?? []).map(s => ({
        ...s,
        start: new Date(s.start),
        end: s.end ? new Date(s.end) : null,
      })).filter(s => !s.end || s.end > now),
      ...(val.ok ? {} : { error: val.error }),
    };
  }
  return results;
}

// ─── DOM rendering ───────────────────────────────────────────────────────────

export function showStatus(msg, type = "loading") {
  const el = document.getElementById("statusBanner");
  el.style.display = "flex";
  el.className = `status-banner ${type}`;
  el.innerHTML = `<div class="status-dot"></div><span>${msg}</span>`;
  if (type === "success") setTimeout(() => { el.style.display = "none"; }, 3000);
}

function hideStatus() {
  document.getElementById("statusBanner").style.display = "none";
}

function showSkeletons(n = 8) {
  const rows = Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="skeleton" style="height:26px;width:80px;flex-shrink:0"></div>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        <div class="skeleton" style="height:11px;width:140px"></div>
        <div class="skeleton" style="height:9px;width:80px"></div>
      </div>
      <div class="skeleton" style="height:11px;width:50px;flex-shrink:0"></div>
    </div>`).join("");
  document.getElementById("content").innerHTML = `<div class="session-rows">${rows}</div>`;
}

function renderLegend(data) {
  const legend = document.getElementById("rinkLegend");
  let html = '<span class="filter-label">Rinks</span>';
  html += Object.entries(data)
    .filter(([, r]) => !r.rink.legendKey)
    .map(([key, r]) =>
    `<span class="legend-chip${selectedRinks.has(key) ? ' selected' : ''}" data-rink="${key}">
      <span class="legend-dot" style="background:${r.rink.color}"></span>
      ${r.rink.city.toUpperCase()}${!r.ok ? ' !' : ''}
    </span>`
  ).join("");
  html += `<span class="legend-clear${selectedRinks.size > 0 ? ' visible' : ''}" id="legendClear">Clear &#x2715;</span>`;
  legend.innerHTML = html;

  legend.querySelectorAll(".legend-chip").forEach(el => {
    el.addEventListener("click", () => {
      const key = el.dataset.rink;
      if (selectedRinks.has(key)) selectedRinks.delete(key);
      else selectedRinks.add(key);
      renderLegend(data);
      renderSessions(data);
    });
  });

  const clearBtn = document.getElementById("legendClear");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selectedRinks.clear();
      renderLegend(data);
      renderSessions(data);
    });
  }
}

export function renderSessions(data) {
  const content = document.getElementById("content");
  const now = new Date();
  const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);

  let all = [];
  const errors = [];

  for (const [key, r] of Object.entries(data)) {
    if (!r.ok) errors.push({ key, ...r });
    r.sessions.forEach(s => all.push({ ...s, rinkKey: key, rink: r.rink }));
  }

  // Apply rink filter (multi-select union) then time filter
  all = all.filter(s => {
    const effectiveRinkKey = s.rink.legendKey ?? s.rinkKey;
    if (selectedRinks.size > 0 && !selectedRinks.has(effectiveRinkKey)) return false;
    if (activeFilter === "available") return !s.soldOut;
    if (activeFilter === "female") return !!(s.subtitle && /female|non.binary|women/i.test(s.subtitle));
    if (activeFilter === "today") {
      const d = s.start; const t = new Date();
      return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
    }
    if (activeFilter === "tomorrow") {
      const d = s.start; const t = new Date(); t.setDate(t.getDate() + 1);
      return d.getFullYear() === t.getFullYear() && d.getMonth() === t.getMonth() && d.getDate() === t.getDate();
    }
    if (activeFilter === "thisweek") return s.start <= weekEnd;
    return true;
  });

  const byDay = {};
  all.forEach(s => {
    const k = dayKey(s.start);
    if (!byDay[k]) byDay[k] = [];
    byDay[k].push(s);
  });

  const sortedDays = Object.keys(byDay).sort();

  const fallbacks = errors.filter(e =>
    e.error?.includes("CORS") || e.error?.includes("LeagueApps") ||
    e.error?.includes("directly") || e.error?.includes("book directly")
  );
  const hardErrors = errors.filter(e => !fallbacks.includes(e));

  let html = "";

  const effectiveKey = (e) => e.rink.legendKey ?? e.key;
  if (fallbacks.length && (selectedRinks.size === 0 || fallbacks.some(e => selectedRinks.has(effectiveKey(e))))) {
    const visibleFallbacks = selectedRinks.size === 0 ? fallbacks : fallbacks.filter(e => selectedRinks.has(effectiveKey(e)));
    if (visibleFallbacks.length) {
      html += `<div class="fallback-grid">` +
        visibleFallbacks.map(e => {
          const r = e.rink;
          const reason = e.error?.includes("LeagueApps")
            ? "Sessions require login to book"
            : "Live data unavailable — book online";
          return `<div class="fallback-card" style="--rink-color:${r.color}">
            <div class="fc-rink">${r.city}</div>
            <div class="fc-name">${r.name}</div>
            <div class="fc-reason">${reason}</div>
            <a class="fc-link" href="${escapeHtml(safeUrl(r.url))}" target="_blank" rel="noopener">View schedule ↗</a>
          </div>`;
        }).join("") +
      `</div>`;
    }
  }

  hardErrors.forEach(e => {
    html += `<div class="rink-error">
      <span>⚠️</span>
      <span><strong>${e.rink.name}</strong> failed to load — <a href="${escapeHtml(safeUrl(e.rink.url))}" target="_blank" rel="noopener">check the rink's own site ↗</a></span>
    </div>`;
  });

  if (sortedDays.length === 0) {
    html += `<div class="empty-state">
      <div class="big-icon">🏒</div>
      <h3>No sessions found</h3>
      <p>Try a different filter, or check back later.</p>
    </div>`;
  } else {
    sortedDays.forEach(day => {
      const sessions = byDay[day].sort((a, b) => a.start - b.start);
      const { name, full } = fmtDayLabel(day);
      html += `<div class="day-section">
        <div class="day-header">
          <div class="day-name-block${name === 'Today' ? ' today-block' : ''}">${name}</div>
          <div class="day-date-block">${full}</div>
          <div class="day-count-block">${sessions.length} session${sessions.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="session-rows">
          ${sessions.map(s => {
            if (GROUPS_ENABLED) sessionMap[mkSessionKey(s)] = s;
            return sessionRow(s);
          }).join("")}
        </div>
      </div>`;
    });
  }

  content.innerHTML = html;
  if (GROUPS_ENABLED && getGroups().length) void updateGoingIndicators();

  const total = all.filter(s => !s.soldOut).length;
  const liveRinks = new Set(all.map(s => s.rinkKey)).size;
  const totalRinks = liveRinks + fallbacks.length;
  const lastUpdated = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  document.getElementById("headerMeta").innerHTML =
    `<strong>${total}</strong> available &nbsp;·&nbsp; <strong>${totalRinks}</strong> rinks &nbsp;·&nbsp; ${lastUpdated}`;
}

function sessionRow(s) {
  const timeStr = fmtTime(s.start);
  const dur = fmtDuration(s.start, s.end);
  const spotsStr = s.spots != null
    ? s.spots <= 3
      ? `<span class="badge badge-spots low">${s.spots} spot${s.spots !== 1 ? "s" : ""} left</span>`
      : `<span class="badge badge-spots">${s.spots} spots</span>`
    : "";
  const priceStr = s.price ? `<span class="badge badge-price">${s.price}</span>` : "";
  const subtitleBadge = s.subtitle ? `<div class="row-subtitle"><span class="badge badge-subtitle">${s.subtitle}</span></div>` : "";
  const soldOutBadge = s.soldOut ? `<span class="badge badge-sold-out">Sold out</span>` : "";

  const linkAttrs = s.bookUrl && !s.soldOut
    ? `href="${escapeHtml(safeUrl(s.bookUrl))}" target="_blank" rel="noopener"`
    : '';

  // Going indicator — only rendered when flag is on and user is in at least one group
  const goingBtn = GROUPS_ENABLED && getGroups().length
    ? `<span role="button" tabindex="0" class="going-btn" data-session-key="${mkSessionKey(s)}" aria-label="Who's going">${GOING_PERSON_SVG}</span>`
    : '';

  return `<a class="session-row${s.soldOut ? " sold-out" : ""}" style="--rink-color:${s.rink.color}" ${linkAttrs}>
    <div class="row-time">${timeStr}</div>
    <div class="row-info">
      <div class="row-rink">${s.rink.name}</div>
      <div class="row-city">${s.rink.city}</div>
      ${subtitleBadge}
    </div>
    <div class="row-right">
      ${dur ? `<div class="row-duration">${dur}</div>` : ''}
      ${goingBtn}
      <div class="row-badges">${priceStr}${spotsStr}${soldOutBadge}</div>
    </div>
  </a>`;
}

// ─── App bootstrap ────────────────────────────────────────────────────────────

async function loadData() {
  const btn = document.getElementById("refreshBtn");
  btn.classList.add("spinning");
  showSkeletons();
  showStatus("Fetching sessions from all rinks…");

  try {
    setAllData(await fetchAll());
    const totalSessions = Object.values(allData).reduce((n, r) => n + r.sessions.length, 0);
    showStatus(`Loaded ${totalSessions} sessions`, "success");
    renderLegend(allData);
    renderSessions(allData);
  } catch (err) {
    showStatus("We couldn't load today's schedule. Try refreshing in a moment.", "error");
    document.getElementById("content").innerHTML = `<div class="empty-state"><div class="big-icon">⚠️</div><h3>Load failed</h3><p>We couldn't load today's schedule. Try refreshing in a moment.</p></div>`;
  } finally {
    btn.classList.remove("spinning");
  }
}

// Filter buttons (time/availability only)
document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    setActiveFilter(btn.dataset.filter);
    if (allData) renderSessions(allData);
  });
});

// Refresh button
document.getElementById("refreshBtn").addEventListener("click", loadData);

// Auto-refresh every 10 minutes
setInterval(loadData, 10 * 60 * 1000);

// Initial load
loadData();
