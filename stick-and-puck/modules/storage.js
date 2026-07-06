import { getGroupSlug } from '/stick-and-puck/modules/utils.js';

export const GROUPS_ENABLED = true;

// ─── Group feature ─────────────────────────────────────────────────────────────
// Multi-group model: displayName is stored at a top-level key shared across all
// groups. Each group entry is { groupName, password, memberId }.
// Old single-group format (postandin_group) is migrated automatically on load.

const GROUPS_LS_KEY       = 'postandin_groups';
const DISPLAY_NAME_LS_KEY = 'postandin_displayName';
const LEGACY_LS_KEY       = 'postandin_group';
export const GROUP_COLORS = ['#B94040', '#3D7A6F', '#7B5EA7', '#4A6FA5', '#C47A30', '#6B7A3A'];

// Detect if localStorage is fully blocked (e.g. "Block All Cookies" in Safari settings).
// Note: Private Browsing mode still allows localStorage within the session — it's just
// wiped when the browser closes. That case is handled via the modal-notice warning.
export const _lsAvailable = (() => {
  try {
    const k = '__sp_ls_test__';
    localStorage.setItem(k, '1');
    const ok = localStorage.getItem(k) === '1';
    localStorage.removeItem(k);
    return ok;
  } catch {
    return false;
  }
})();

export function migrateStorage() {
  const raw = localStorage.getItem(LEGACY_LS_KEY);
  if (!raw) return;
  try {
    const old = JSON.parse(raw);
    if (old?.groupName) {
      if (old.displayName && !localStorage.getItem(DISPLAY_NAME_LS_KEY))
        localStorage.setItem(DISPLAY_NAME_LS_KEY, old.displayName);
      const slug = getGroupSlug(old);
      const existing = getGroups();
      if (!existing.some(g => getGroupSlug(g) === slug))
        setGroups([...existing, { groupName: old.groupName, password: old.password, memberId: old.memberId }]);
    }
  } catch {}
  localStorage.removeItem(LEGACY_LS_KEY);
}

export function getGroups() {
  if (!GROUPS_ENABLED) return [];
  try { return JSON.parse(localStorage.getItem(GROUPS_LS_KEY) || '[]'); }
  catch { return []; }
}

export function setGroups(arr) {
  if (arr?.length) localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(arr));
  else localStorage.removeItem(GROUPS_LS_KEY);
}

export function getDisplayName() {
  return localStorage.getItem(DISPLAY_NAME_LS_KEY) || '';
}

export function setDisplayName(name) {
  if (name) localStorage.setItem(DISPLAY_NAME_LS_KEY, name);
  else localStorage.removeItem(DISPLAY_NAME_LS_KEY);
}

// Push current localStorage state up to the server session (fire-and-forget).
export function syncSession() {
  fetch('/api/groups/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ displayName: getDisplayName(), groups: getGroups() }),
  }).catch(err => console.error('syncSession failed:', err));
}

// On page load, hydrate from the server session so groups survive localStorage loss.
// Falls back to migrating any existing localStorage data up to the server.
export async function initSession() {
  if (!/(?:^|;\s*)sp_has_session=1/.test(document.cookie)) return;
  try {
    const r = await fetch('/api/groups/session');
    if (!r.ok) throw new Error();
    const { displayName, groups } = await r.json();
    if (groups?.length) {
      setGroups(groups);
      if (displayName) setDisplayName(displayName);
      ensureGroupColors();
      return;
    }
  } catch {}
  // No server session yet — push localStorage data up if present (legacy migration).
  if (getGroups().length) syncSession();
}

export function ensureGroupColors() {
  try {
    const groups = JSON.parse(localStorage.getItem(GROUPS_LS_KEY) || '[]');
    const currentName = getDisplayName();
    let changed = false;
    const usedColors = groups.filter(g => g.color).map(g => g.color);
    groups.forEach((g, idx) => {
      if (!g.color) {
        const available = GROUP_COLORS.filter(c => !usedColors.includes(c));
        g.color = available.length ? available[0] : GROUP_COLORS[idx % GROUP_COLORS.length];
        usedColors.push(g.color);
        changed = true;
      }
      if (!g.displayName && currentName) { g.displayName = currentName; changed = true; }
    });
    if (changed) localStorage.setItem(GROUPS_LS_KEY, JSON.stringify(groups));
  } catch {}
}
