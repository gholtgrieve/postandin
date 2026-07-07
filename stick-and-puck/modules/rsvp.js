import { escapeHtml, safeColor, GOING_PERSON_SVG, getGroupSlug } from '/stick-and-puck/modules/utils.js';
import { GROUPS_ENABLED, GROUP_COLORS, getGroups, getDisplayName } from '/stick-and-puck/modules/storage.js';
import { rsvpCache, sheetSession } from '/stick-and-puck/modules/state.js';

// Deduplicated names across ALL groups for a session (for amGoing checks)
export function allUniqueGoing(sk) {
  const byGroup = rsvpCache[sk] ?? {};
  const seen = new Set();
  const result = [];
  for (const names of Object.values(byGroup)) {
    for (const n of names) {
      const key = n.toLowerCase();
      if (!seen.has(key)) { seen.add(key); result.push(n); }
    }
  }
  return result;
}

// All groups are always active — same as allUniqueGoing
export function activeUniqueGoing(sk) {
  return allUniqueGoing(sk);
}

export function updateIndicatorEl(btn, sk) {
  const activeNames = activeUniqueGoing(sk);
  if (!activeNames.length) {
    btn.innerHTML = GOING_PERSON_SVG;
    btn.classList.remove('has-going');
    return;
  }
  btn.classList.add('has-going');
  btn.innerHTML = `${GOING_PERSON_SVG}<span class="going-count">${activeNames.length}</span>`;
}

export async function updateGoingIndicators() {
  if (!GROUPS_ENABLED) return;
  const groups = getGroups();
  if (!groups.length) return;
  const btns = [...document.querySelectorAll('.going-btn')];
  if (!btns.length) return;
  const keys = [...new Set(btns.map(b => b.dataset.sessionKey))];

  // One request for all groups instead of one per (session × group).
  const slugs = groups.map(g => getGroupSlug(g));
  let groupMaps = {};
  try {
    const r = await fetch(`/api/groups/rsvp?groupSlugs=${slugs.map(encodeURIComponent).join(',')}`);
    if (r.ok) groupMaps = await r.json();
  } catch {}

  for (const sk of keys) {
    rsvpCache[sk] = {};
    for (const slug of slugs) {
      rsvpCache[sk][slug] = (groupMaps[slug] ?? {})[sk] ?? [];
    }
  }

  btns.forEach(btn => updateIndicatorEl(btn, btn.dataset.sessionKey));
  maybeShowIconTip();
}

export function maybeShowIconTip() {
  if (localStorage.getItem('postandin_icon_tip_seen')) return;
  const firstGoing = document.querySelector('.going-btn.has-going');
  if (!firstGoing) return;

  const tip = document.createElement('div');
  tip.className = 'icon-tip';
  tip.textContent = "Tap the person icon to see who’s going and add yourself";
  document.body.appendChild(tip);

  const rect = firstGoing.getBoundingClientRect();
  tip.style.top = (rect.bottom + 6) + 'px';
  tip.style.right = '16px';

  const dismiss = () => {
    tip.remove();
    localStorage.setItem('postandin_icon_tip_seen', '1');
    document.removeEventListener('click', dismiss);
    document.removeEventListener('touchstart', dismiss);
  };
  requestAnimationFrame(() => {
    document.addEventListener('click', dismiss);
    document.addEventListener('touchstart', dismiss);
  });
}

export async function doToggleGoing(s, sk, goingValue) {
  const groups = getGroups();
  const displayName = getDisplayName();
  if (!groups.length || !displayName) return;
  rsvpCache[sk] = rsvpCache[sk] ?? {};
  await Promise.all(groups.map(async g => {
    const slug = getGroupSlug(g);
    try {
      const r = await fetch('/api/groups/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: sk, groupSlug: slug, memberId: g.memberId, displayName, going: goingValue }),
      });
      rsvpCache[sk][slug] = (await r.json()).going ?? [];
    } catch(e) { console.error('RSVP error', e); }
  }));
  document.querySelectorAll(`.going-btn[data-session-key="${CSS.escape(sk)}"]`).forEach(btn => {
    updateIndicatorEl(btn, sk);
  });
  if (sheetSession?.sk === sk) _refreshSheetContent(sk);
}

export function _refreshSheetContent(sk) {
  const groups = getGroups();
  const displayName = getDisplayName();
  const byGroup = rsvpCache[sk] ?? {};
  const activeGroups = groups;
  // amGoing check uses all groups
  const all = allUniqueGoing(sk);
  const amGoing = !!displayName && all.some(n => n.toLowerCase() === displayName.toLowerCase());

  const sheetNamesEl = document.getElementById('sheetNames');
  if (!activeGroups.length) {
    sheetNamesEl.innerHTML = '<span style="color:var(--white-3)">Nobody yet</span>';
  } else {
    sheetNamesEl.innerHTML = activeGroups.map(g => {
      const slug = getGroupSlug(g);
      const names = byGroup[slug] ?? [];
      return `<div class="sheet-group-cluster">
        <div class="sheet-group-label" style="color:${safeColor(g.color, 'var(--white-3)', GROUP_COLORS)}">Going from ${escapeHtml(g.groupName)}</div>
        ${names.length
          ? names.map(n => `<div class="sheet-going-name" style="padding-left:14px">${escapeHtml(n)}</div>`).join('')
          : '<div class="sheet-going-name" style="color:var(--white-3);padding-left:14px">Nobody yet</div>'
        }
      </div>`;
    }).join('');
  }

  const btn = document.getElementById('sheetToggleBtn');
  btn.textContent = amGoing ? "I'm not going" : "I'm going";
  btn.className = `sheet-toggle-btn${amGoing ? ' going' : ''}`;
}

// When joining/creating a group, backfill RSVPs for sessions where user is already going
export async function backfillRsvpForGroup(g) {
  const displayName = getDisplayName();
  if (!displayName) return;
  const slug = getGroupSlug(g);
  await Promise.all(Object.entries(rsvpCache).map(async ([sk, byGroup]) => {
    const amGoing = Object.values(byGroup).some(names =>
      names.some(n => n.toLowerCase() === displayName.toLowerCase())
    );
    if (!amGoing) return;
    try {
      const r = await fetch('/api/groups/rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionKey: sk, groupSlug: slug, memberId: g.memberId, displayName, going: true }),
      });
      if (r.ok) rsvpCache[sk][slug] = (await r.json()).going ?? [];
    } catch {}
  }));
}
