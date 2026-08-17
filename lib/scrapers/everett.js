// Everett / Angel of the Winds scraper — server-side port of the client-side fetchEverett().
// Returns normalized Stick & Puck sessions by default. Callers may opt into
// Drop-in Hockey and Public Skate by passing them in `activities`.
// where start/end are local-time strings (no timezone suffix, Pacific local).
// Past-session filtering is left to the client (avoids UTC/Pacific ambiguity).

import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  activitySet,
  classifyEverettActivity,
  eligibility,
} from '../activities.js';

const BASE_URL = 'https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443';
const PUBLIC_SKATE_URL = 'https://schedule.bondsports.co/schedule/everett-community-ice-rink?layout=list';
export const EVERETT_SHEETS = Object.freeze(['Community Rink', 'Main Rink']);

export async function scrapeEverett({ activities } = {}) {
  const now = new Date();
  const startDate = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const endDate = future.toISOString().slice(0, 10);

  const res = await fetch(`${BASE_URL}?startDate=${startDate}&endDate=${endDate}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);

  const data = await res.json();
  return normalizeEverettData(data, { activities });
}

export function normalizeEverettData(data, { activities } = {}) {
  const requested = activitySet(activities);
  const sessions = [];
  for (const rink of data) {
    if (!EVERETT_SHEETS.includes(rink.name)) continue;
    for (const slot of rink.slots) {
      const activity = classifyEverettActivity(slot.title);
      if (!activity || !requested.has(activity)) continue;
      const isPublicSkate = activity === ACTIVITY_PUBLIC_SKATE;
      const dateStr = slot.startDate.slice(0, 10);
      const isDropIn = activity === ACTIVITY_DROP_IN_HOCKEY;
      sessions.push({
        id: `everett-${slot.id}`,
        start: `${dateStr}T${slot.startTime}`,
        end:   `${dateStr}T${slot.endTime}`,
        title: isPublicSkate ? 'Public Skate' : slot.title,
        subtitle: isDropIn ? 'Eligibility details not published · Pay at desk' : null,
        spots: null,
        price: null,
        soldOut: false,
        bookUrl: isPublicSkate ? PUBLIC_SKATE_URL : 'https://aotw-arena.web.app/',
        activity,
        sourceLabel: slot.title,
        sheet: rink.name,
        sheetKey: rink.name === 'Main Rink' ? 'main-rink' : null,
        eligibility: isDropIn
          ? eligibility({ notes: 'Eligibility details not published; check with the rink.' })
          : eligibility(),
        registration: {
          required: null,
          method: isDropIn ? 'pay-at-desk' : null,
          capacity: null,
          spots: null,
          goalieSpots: null,
          roles: {},
        },
        cancelled: false,
      });
    }
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}
