// Group feature state
export const sessionMap = {};   // sessionKey → session object, rebuilt on each render
export const rsvpCache  = {};   // sessionKey → { groupSlug: [displayName,...] }
export const selectedRinks = new Set();
