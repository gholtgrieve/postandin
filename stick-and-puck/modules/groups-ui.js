import {
  escapeHtml, safeColor, fmtTime, dayKey, mkSessionKey, getGroupSlug
} from '/stick-and-puck/modules/utils.js';
import {
  GROUPS_ENABLED, GROUP_COLORS, _lsAvailable, getGroups, setGroups,
  getDisplayName, setDisplayName, syncSession
} from '/stick-and-puck/modules/storage.js';
import {
  allData, sessionMap, rsvpCache, sheetSession, setSheetSession,
  setActiveGroupSheet, activeFilter
} from '/stick-and-puck/modules/state.js';
import {
  updateIndicatorEl, _refreshSheetContent
} from '/stick-and-puck/modules/rsvp.js';
import {
  renderSessions, showStatus
} from '/stick-and-puck/modules/schedule.js';

// ─── Group feature ─────────────────────────────────────────────────────────────
// Multi-group model: displayName is stored at a top-level key shared across all
// groups. Each group entry is { groupName, password, memberId }.
// Old single-group format (postandin_group) is migrated automatically on load.

// Returns true if session falls within the window implied by the current day filter
function sessionMatchesDayFilter(s) {
  const now = new Date();
  if (activeFilter === 'today') {
    return dayKey(s.start) === dayKey(now);
  }
  if (activeFilter === 'tomorrow') {
    const tom = new Date(now); tom.setDate(now.getDate() + 1);
    return dayKey(s.start) === dayKey(tom);
  }
  if (activeFilter === 'thisweek') {
    const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + 7);
    return s.start <= weekEnd;
  }
  // 'all', 'available', 'female', or any other non-day filter → next 5 days
  const limit = new Date(now); limit.setDate(now.getDate() + 5); limit.setHours(23, 59, 59, 999);
  return s.start <= limit;
}

function openGroupSheet(group) {
  setActiveGroupSheet(group);
  const slug = getGroupSlug(group);

  document.getElementById('groupSheetTitle').textContent = group.groupName;
  document.getElementById('groupSheetPassword').textContent = `Password: ${group.password}`;

  const overlay = document.getElementById('groupSheetOverlay');
  const sheet   = document.getElementById('groupBottomSheet');
  overlay.classList.add('open');
  sheet.classList.add('open');
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    sheet.classList.add('visible');
  });

  // Build a full session lookup from allData so we can resolve any sk in rsvpCache,
  // even for sessions that are no longer in sessionMap due to active filter changes.
  const lookup = {};
  if (allData) {
    for (const [rinkKey, r] of Object.entries(allData)) {
      for (const s of r.sessions) {
        lookup[mkSessionKey({ ...s, rinkKey })] = { ...s, rinkKey, rink: r.rink };
      }
    }
  }
  // sessionMap entries already have rinkKey+rink and take precedence
  Object.assign(lookup, sessionMap);

  // Read RSVPs directly from rsvpCache — same cache that drives the person-icon indicators
  const now       = new Date();
  const nearLimit = new Date(now);
  nearLimit.setDate(now.getDate() + 5);
  nearLimit.setHours(23, 59, 59, 999);

  const nearWithRsvps = [];
  const farWithRsvps  = [];

  for (const [sk, byGroup] of Object.entries(rsvpCache)) {
    const names = byGroup[slug] ?? [];
    if (!names.length) continue;
    const s = lookup[sk];
    if (!s || s.start < now) continue;
    (s.start <= nearLimit ? nearWithRsvps : farWithRsvps).push({ s, names });
  }

  nearWithRsvps.sort((a, b) => a.s.start - b.s.start);
  farWithRsvps.sort((a, b) => a.s.start - b.s.start);

  function sessionDayLabel(start) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const d = new Date(start); d.setHours(0, 0, 0, 0);
    const diff = Math.round((d - today) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }

  function renderSession({ s, names }) {
    const header  = `${sessionDayLabel(s.start)} ${fmtTime(s.start)} — ${escapeHtml(s.rink.name)}`;
    const nameHtml = names.map(n => `<div class="group-sheet-session-name">${escapeHtml(n)}</div>`).join('');
    return `<div class="group-sheet-session"><div class="group-sheet-session-header">${header}</div>${nameHtml}</div>`;
  }

  const body = document.getElementById('groupSheetBody');

  if (!nearWithRsvps.length && !farWithRsvps.length) {
    body.innerHTML = '<div class="group-sheet-empty">No one has signed up for any upcoming sessions yet.</div>';
    return;
  }

  // If no near-window sessions with RSVPs, show far sessions directly (no collapse)
  const primary   = nearWithRsvps.length ? nearWithRsvps : farWithRsvps;
  const secondary = nearWithRsvps.length ? farWithRsvps  : [];

  body.innerHTML = primary.map(renderSession).join('');

  if (secondary.length) {
    const btn = document.createElement('button');
    btn.className = 'group-sheet-show-more';
    btn.textContent = 'Show more';
    btn.addEventListener('click', () => {
      btn.insertAdjacentHTML('afterend', secondary.map(renderSession).join(''));
      btn.remove();
    });
    body.appendChild(btn);
  }
}

export function closeGroupSheet() {
  const overlay = document.getElementById('groupSheetOverlay');
  const sheet   = document.getElementById('groupBottomSheet');
  overlay.classList.remove('visible');
  sheet.classList.remove('visible');
  overlay.addEventListener('transitionend', () => {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
  }, { once: true });
  setActiveGroupSheet(null);
}

// Groups row — one chip per group (always active) + Manage groups button
export function renderGroupsRow() {
  const el = document.getElementById('groupsRow');
  if (!GROUPS_ENABLED) {
    if (el) el.style.display = 'none';
    return;
  }
  if (!_lsAvailable) {
    el.innerHTML = '<span class="filter-label">Groups</span>' +
      '<span style="font-size:11px;letter-spacing:0.06em;color:var(--red);padding:0 16px;display:flex;align-items:center">' +
      'Groups unavailable — enable browser storage (Settings → Safari → uncheck Block All Cookies)</span>';
    return;
  }
  const groups = getGroups();

  let html = '<span class="filter-label">Groups</span>';
  if (!groups.length) {
    html += `<button class="groups-empty-prompt" id="groupsEmptyPrompt">Join a group to see who's going</button>`;
  } else {
    html += groups.map((g, i) => {
      const color = safeColor(g.color, 'var(--yellow)', GROUP_COLORS);
      return `<button class="group-filter-chip" data-idx="${i}" style="border-left:3px solid ${color}">${escapeHtml(g.groupName)}</button>`;
    }).join('');
  }
  html += `<span class="spacer"></span>`;
  html += `<button class="manage-groups-btn" id="manageGroupsBtn">&#9881; Manage groups<span class="beta-badge">Beta</span></button>`;
  html += `<button class="groups-help-btn" id="groupsHelpBtn" aria-label="What are groups?">?</button>`;
  el.innerHTML = html;

  el.querySelectorAll('.group-filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const idx = Number(chip.dataset.idx);
      const g = getGroups()[idx];
      if (!g) return;
      openGroupSheet(g);
    });
  });

  document.getElementById('manageGroupsBtn')?.addEventListener('click', openGroupModal);
  document.getElementById('groupsHelpBtn')?.addEventListener('click', openIntroModal);
  document.getElementById('groupsEmptyPrompt')?.addEventListener('click', openGroupModal);
}

// Populate the "Your groups" list inside the modal
export function renderModalGroupsList() {
  const groups = getGroups();
  const el = document.getElementById('modalGroupsList');
  if (!el) return;
  if (!groups.length) {
    el.innerHTML = '<div class="modal-groups-empty">No groups yet. Join or create one below.</div>';
    return;
  }
  el.innerHTML = groups.map((g, i) => {
    const color = safeColor(g.color, 'var(--yellow)', GROUP_COLORS);
    return `<div class="modal-group-row">
      <span class="modal-group-name" style="color:${color}">${escapeHtml(g.groupName)}</span>
      <button class="modal-leave-btn" data-idx="${i}">Leave</button>
    </div>`;
  }).join('');

  el.querySelectorAll('.modal-leave-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.idx);
      const current = getGroups();
      const g = current[idx];
      if (!g) return;
      const ok = await leaveGroup(g);
      if (!ok) {
        showStatus("Couldn't leave the group — try again.", "error");
        return;
      }
      setGroups(current.filter((_, i) => i !== idx));
      renderModalGroupsList();
      renderGroupsRow();
      if (allData) renderSessions(allData);
    });
  });
}

async function leaveGroup(g) {
  try {
    const r = await fetch('/api/groups/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupName: g.groupName, password: g.password, memberId: g.memberId }),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// Bottom sheet
export function openBottomSheet(s, sk) {
  setSheetSession({ s, sk });
  document.getElementById('sheetRink').textContent     = s.rink.name.toUpperCase();
  document.getElementById('sheetDatetime').textContent =
    `${s.start.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric' })} · ${fmtTime(s.start)}`;
  _refreshSheetContent(sk);
  const overlay = document.getElementById('sheetOverlay');
  const sheet   = document.getElementById('bottomSheet');
  overlay.classList.add('open');
  sheet.classList.add('open');
  requestAnimationFrame(() => {
    overlay.classList.add('visible');
    sheet.classList.add('visible');
  });
}

export function closeBottomSheet() {
  const overlay = document.getElementById('sheetOverlay');
  const sheet   = document.getElementById('bottomSheet');
  overlay.classList.remove('visible');
  sheet.classList.remove('visible');
  overlay.addEventListener('transitionend', () => {
    overlay.classList.remove('open');
    sheet.classList.remove('open');
  }, { once: true });
  setSheetSession(null);
}

// Sync the name section between display mode and edit mode
export function _refreshModalNameSection() {
  const name      = getDisplayName();
  const displayEl = document.getElementById('modalNameDisplay');
  const editRow   = document.getElementById('modalNameEditRow');
  const nameVal   = document.getElementById('modalNameValue');
  const cancelBtn = document.getElementById('modalNameCancelBtn');
  if (!displayEl || !editRow) return;
  if (name) {
    if (nameVal) nameVal.textContent = name;
    displayEl.style.display = '';
    editRow.style.display   = 'none';
  } else {
    displayEl.style.display = 'none';
    editRow.style.display   = '';
    if (cancelBtn) cancelBtn.style.display = 'none';
  }
}

// Rename: update localStorage + group entries + backfill RSVPs
export async function updateDisplayNameAndBackfill(newName) {
  const oldName = getDisplayName();
  setDisplayName(newName);
  setGroups(getGroups().map(g => ({ ...g, displayName: newName })));
  syncSession();
  if (!oldName) return;
  const myGroups = getGroups();
  await Promise.all(Object.entries(rsvpCache).map(async ([sk, byGroup]) => {
    const wasGoing = Object.values(byGroup).some(names =>
      names.some(n => n.toLowerCase() === oldName.toLowerCase())
    );
    if (!wasGoing) return;
    await Promise.all(myGroups.map(async g => {
      const slug = getGroupSlug(g);
      try {
        await fetch('/api/groups/rsvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionKey: sk, groupSlug: slug, memberId: g.memberId, displayName: oldName, going: false }),
        });
        const r = await fetch('/api/groups/rsvp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionKey: sk, groupSlug: slug, memberId: g.memberId, displayName: newName, going: true }),
        });
        if (r.ok) rsvpCache[sk][slug] = (await r.json()).going ?? [];
      } catch {}
    }));
  }));
  document.querySelectorAll('.going-btn').forEach(btn => updateIndicatorEl(btn, btn.dataset.sessionKey));
  if (sheetSession) _refreshSheetContent(sheetSession.sk);
}

// Swap modal body for a brief success confirmation, then close on "Got it".
// Only shown the first time (guarded by postandin_join_confirmed flag).
export function showJoinConfirm(heading) {
  document.getElementById('modalConfirmHeading').textContent = heading;
  document.getElementById('modalBody').style.display    = 'none';
  document.getElementById('modalNotice').style.display  = 'none';
  document.getElementById('modalConfirm').style.display = '';
}

// Manage Groups modal
export function openGroupModal() {
  // Reset any leftover confirmation state from a previous open
  document.getElementById('modalConfirm').style.display = 'none';
  document.getElementById('modalBody').style.display    = '';
  document.getElementById('modalNotice').style.display  = '';

  ['modalGroupName', 'modalGroupPassword', 'modalJoinGroupName', 'modalJoinPassword'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['modalCreateError', 'modalJoinError', 'modalNameError'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '';
  });
  const nameInput = document.getElementById('modalDisplayName');
  if (nameInput) nameInput.value = '';
  _refreshModalNameSection();

  renderModalGroupsList();

  const overlay = document.getElementById('modalOverlay');
  overlay.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));

  setTimeout(() => {
    if (!getDisplayName()) {
      document.getElementById('modalDisplayName')?.focus();
    } else {
      document.getElementById('modalJoinGroupName')?.focus();
    }
  }, 160);
}

export function closeGroupModal() {
  const overlay = document.getElementById('modalOverlay');
  overlay.classList.remove('visible');
  overlay.addEventListener('transitionend', () => overlay.classList.remove('open'), { once: true });
}

// Intro / help modal
function openIntroModal() {
  const overlay = document.getElementById('introModalOverlay');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

export function closeIntroModal() {
  localStorage.setItem('postandin_groups_intro_seen', '1');
  const overlay = document.getElementById('introModalOverlay');
  overlay.classList.remove('visible');
  overlay.addEventListener('transitionend', () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }, { once: true });
}

export function maybeShowIntroModal() {
  if (!GROUPS_ENABLED) return;
  if (getGroups().length) return;
  if (localStorage.getItem('postandin_groups_intro_seen')) return;
  openIntroModal();
}

function openSorryModal() {
  const overlay = document.getElementById('sorryModalOverlay');
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.add('open');
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

export function closeSorryModal() {
  localStorage.setItem('postandin_sorry_v2', '1');
  const overlay = document.getElementById('sorryModalOverlay');
  overlay.classList.remove('visible');
  overlay.addEventListener('transitionend', () => {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
  }, { once: true });
}

export function maybeShowSorryModal() {
  if (!GROUPS_ENABLED) return;
  if (!localStorage.getItem('postandin_groups_intro_seen')) return;
  if (localStorage.getItem('postandin_sorry_v2')) return;
  setTimeout(openSorryModal, 300);
}
