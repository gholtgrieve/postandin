import { RINKS } from '/lib/rinks.js';
import {
  escapeHtml, safeUrl, safeColor, fmtTime, fmtDuration,
  dayKey, fmtDayLabel, mkSessionKey, getGroupSlug, GOING_PERSON_SVG
} from '/stick-and-puck/modules/utils.js';
import {
  GROUPS_ENABLED, GROUP_COLORS, _lsAvailable, migrateStorage,
  getGroups, setGroups, getDisplayName, setDisplayName, syncSession,
  initSession, ensureGroupColors
} from '/stick-and-puck/modules/storage.js';
import {
  sessionMap, rsvpCache, selectedRinks,
  allData, setAllData, activeFilter, setActiveFilter,
  sheetSession, setSheetSession, activeGroupSheet, setActiveGroupSheet
} from '/stick-and-puck/modules/state.js';
import {
  allUniqueGoing, activeUniqueGoing, updateIndicatorEl,
  updateGoingIndicators, maybeShowIconTip, doToggleGoing,
  _refreshSheetContent, backfillRsvpForGroup
} from '/stick-and-puck/modules/rsvp.js';
import { renderSessions, showStatus } from '/stick-and-puck/modules/schedule.js';
import {
  closeGroupSheet, renderGroupsRow, renderModalGroupsList, openBottomSheet,
  closeBottomSheet, _refreshModalNameSection, updateDisplayNameAndBackfill,
  showJoinConfirm, openGroupModal, closeGroupModal, closeIntroModal,
  maybeShowIntroModal, closeSorryModal, maybeShowSorryModal
} from '/stick-and-puck/modules/groups-ui.js';

if (GROUPS_ENABLED) {
  migrateStorage();
  ensureGroupColors();

  // Event delegation: going-btn clicks inside session rows
  document.getElementById('content').addEventListener('click', async e => {
    const btn = e.target.closest('.going-btn');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const sk = btn.dataset.sessionKey;
    const s  = sessionMap[sk];
    if (!s) return;
    const groups = getGroups();
    if (!groups.length) { openGroupModal(); return; }
    const all = allUniqueGoing(sk);
    if (all.length === 0) {
      await doToggleGoing(s, sk, true);
    } else {
      openBottomSheet(s, sk);
    }
  });

  // Sheet wiring
  document.getElementById('sheetOverlay').addEventListener('click', closeBottomSheet);
  document.getElementById('sheetCloseBtn').addEventListener('click', closeBottomSheet);

  document.getElementById('sheetToggleBtn').addEventListener('click', async () => {
    if (!sheetSession) return;
    const groups = getGroups();
    if (!groups.length) return;
    const displayName = getDisplayName();
    const all = allUniqueGoing(sheetSession.sk);
    const amGoing = !!displayName && all.some(n => n.toLowerCase() === displayName.toLowerCase());
    await doToggleGoing(sheetSession.s, sheetSession.sk, !amGoing);
  });

  // Modal wiring
  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modalOverlay')) closeGroupModal();
  });
  document.getElementById('modalCloseBtn').addEventListener('click', closeGroupModal);

  // Name section — edit / save / cancel
  document.getElementById('modalNameEditBtn')?.addEventListener('click', () => {
    const nameInput = document.getElementById('modalDisplayName');
    if (nameInput) nameInput.value = getDisplayName();
    document.getElementById('modalNameDisplay').style.display  = 'none';
    document.getElementById('modalNameEditRow').style.display  = '';
    document.getElementById('modalNameCancelBtn').style.display = '';
    document.getElementById('modalNameError').textContent = '';
    nameInput?.focus();
  });

  document.getElementById('modalNameSaveBtn')?.addEventListener('click', async () => {
    const nameInput = document.getElementById('modalDisplayName');
    const newName   = nameInput?.value.trim() ?? '';
    if (!newName)          { document.getElementById('modalNameError').textContent = 'Enter your name.'; return; }
    if (newName.length > 30) { document.getElementById('modalNameError').textContent = 'Name must be 30 characters or fewer.'; return; }
    document.getElementById('modalNameError').textContent = '';
    await updateDisplayNameAndBackfill(newName);
    _refreshModalNameSection();
  });

  document.getElementById('modalNameCancelBtn')?.addEventListener('click', () => {
    document.getElementById('modalNameError').textContent = '';
    _refreshModalNameSection();
  });

  document.getElementById('modalCreateBtn').addEventListener('click', async () => {
    const editRow   = document.getElementById('modalNameEditRow');
    const inEditMode = editRow && editRow.style.display !== 'none';
    const displayName = inEditMode
      ? (document.getElementById('modalDisplayName')?.value.trim() || getDisplayName())
      : getDisplayName();
    const groupName = document.getElementById('modalGroupName').value.trim();
    const password  = document.getElementById('modalGroupPassword').value.trim();

    if (!displayName)          { document.getElementById('modalNameError').textContent = 'Enter your name.'; return; }
    if (displayName.length > 30) { document.getElementById('modalNameError').textContent = 'Name must be 30 characters or fewer.'; return; }
    if (!groupName)            { document.getElementById('modalCreateError').textContent = 'Enter a group name.'; return; }
    if (groupName.length > 30) { document.getElementById('modalCreateError').textContent = 'Group name must be 30 characters or fewer.'; return; }
    if (!password)             { document.getElementById('modalCreateError').textContent = 'Enter a password.'; return; }
    if (password.length > 50)  { document.getElementById('modalCreateError').textContent = 'Password must be 50 characters or fewer.'; return; }

    const slug = getGroupSlug({ groupName, password });
    if (getGroups().some(g => getGroupSlug(g) === slug)) {
      document.getElementById('modalCreateError').textContent = "You're already in this group."; return;
    }
    document.getElementById('modalCreateError').textContent = '';

    try {
      const r = await fetch('/api/groups/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName, password, displayName }),
      });
      const d = await r.json();
      if (!r.ok) { document.getElementById('modalCreateError').textContent = d.error ?? 'Failed.'; return; }
      setDisplayName(displayName);
      const existingColors = getGroups().map(g => g.color).filter(Boolean);
      const available = GROUP_COLORS.filter(c => !existingColors.includes(c));
      const color = available.length ? available[0] : GROUP_COLORS[getGroups().length % GROUP_COLORS.length];
      const newGroup = { groupName, password, memberId: d.memberId, displayName, color };
      setGroups([...getGroups(), newGroup]);
      syncSession();
      await backfillRsvpForGroup(newGroup);
      document.getElementById('modalGroupName').value    = '';
      document.getElementById('modalGroupPassword').value = '';
      _refreshModalNameSection();
      renderModalGroupsList();
      renderGroupsRow();
      if (allData) renderSessions(allData);
      if (!localStorage.getItem('postandin_join_confirmed')) {
        showJoinConfirm('Group created!');
      } else {
        closeGroupModal();
      }
    } catch { document.getElementById('modalCreateError').textContent = 'Network error. Try again.'; }
  });

  document.getElementById('modalJoinBtn').addEventListener('click', async () => {
    const editRow    = document.getElementById('modalNameEditRow');
    const inEditMode = editRow && editRow.style.display !== 'none';
    const displayName = inEditMode
      ? (document.getElementById('modalDisplayName')?.value.trim() || getDisplayName())
      : getDisplayName();
    const groupName = document.getElementById('modalJoinGroupName').value.trim();
    const password  = document.getElementById('modalJoinPassword').value.trim();

    if (!displayName)          { document.getElementById('modalNameError').textContent = 'Enter your name.'; return; }
    if (displayName.length > 30) { document.getElementById('modalNameError').textContent = 'Name must be 30 characters or fewer.'; return; }
    if (!groupName)            { document.getElementById('modalJoinError').textContent = 'Enter the group name.'; return; }
    if (groupName.length > 30) { document.getElementById('modalJoinError').textContent = 'Group name must be 30 characters or fewer.'; return; }
    if (!password)             { document.getElementById('modalJoinError').textContent = 'Enter the password.'; return; }
    if (password.length > 50)  { document.getElementById('modalJoinError').textContent = 'Password must be 50 characters or fewer.'; return; }

    const slug = getGroupSlug({ groupName, password });
    if (getGroups().some(g => getGroupSlug(g) === slug)) {
      document.getElementById('modalJoinError').textContent = "You're already in this group."; return;
    }
    document.getElementById('modalJoinError').textContent = '';

    try {
      const r = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupName, password, displayName }),
      });
      const d = await r.json();
      if (!r.ok) { document.getElementById('modalJoinError').textContent = d.error ?? 'Failed.'; return; }
      setDisplayName(displayName);
      const existingColors = getGroups().map(g => g.color).filter(Boolean);
      const available = GROUP_COLORS.filter(c => !existingColors.includes(c));
      const color = available.length ? available[0] : GROUP_COLORS[getGroups().length % GROUP_COLORS.length];
      const newGroup = { groupName, password, memberId: d.memberId, displayName, color };
      setGroups([...getGroups(), newGroup]);
      syncSession();
      await backfillRsvpForGroup(newGroup);
      document.getElementById('modalJoinGroupName').value = '';
      document.getElementById('modalJoinPassword').value  = '';
      _refreshModalNameSection();
      renderModalGroupsList();
      renderGroupsRow();
      if (allData) renderSessions(allData);
      if (!localStorage.getItem('postandin_join_confirmed')) {
        showJoinConfirm("You're in!");
      } else {
        closeGroupModal();
      }
    } catch { document.getElementById('modalJoinError').textContent = 'Network error. Try again.'; }
  });

  // Group info sheet wiring
  document.getElementById('groupSheetOverlay').addEventListener('click', closeGroupSheet);
  document.getElementById('groupSheetCloseBtn').addEventListener('click', closeGroupSheet);

  // Intro modal wiring
  document.getElementById('introJoinBtn').addEventListener('click', () => {
    closeIntroModal();
    openGroupModal();
  });
  document.getElementById('introLaterBtn').addEventListener('click', closeIntroModal);
  document.getElementById('introModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('introModalOverlay')) closeIntroModal();
  });

  document.getElementById('modalConfirmGotItBtn').addEventListener('click', () => {
    localStorage.setItem('postandin_join_confirmed', '1');
    document.getElementById('modalConfirm').style.display = 'none';
    document.getElementById('modalBody').style.display    = '';
    document.getElementById('modalNotice').style.display  = '';
    closeGroupModal();
  });

  document.getElementById('sorryDismissBtn').addEventListener('click', closeSorryModal);
  document.getElementById('sorryModalOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('sorryModalOverlay')) closeSorryModal();
  });

  // Render immediately with whatever is in localStorage, then update from server session.
  renderGroupsRow();
  void (async () => {
    await initSession();
    renderGroupsRow();
    if (allData) {
      renderSessions(allData);
      void updateGoingIndicators();
    }
    maybeShowIntroModal();
    maybeShowSorryModal();
  })();
}
