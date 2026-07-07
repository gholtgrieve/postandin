export let allData = null;
export function setAllData(v) { allData = v; }

export let activeFilter = "all";
export function setActiveFilter(v) { activeFilter = v; }

// Group feature state
export const sessionMap = {};   // sessionKey → session object, rebuilt on each render
export const rsvpCache  = {};   // sessionKey → { groupSlug: [displayName,...] }
export const selectedRinks = new Set();

export let sheetSession = null; // { s, sk } for the currently-open bottom sheet
export function setSheetSession(v) { sheetSession = v; }

// Group info bottom sheet
export let activeGroupSheet = null;
export function setActiveGroupSheet(v) { activeGroupSheet = v; }
