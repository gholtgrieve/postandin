// Everett / Angel of the Winds scraper — server-side port of the client-side fetchEverett().
// Returns sessions as { id, start, end, title, subtitle, spots, price, soldOut, bookUrl }
// where start/end are local-time strings (no timezone suffix, Pacific local).
// Past-session filtering is left to the client (avoids UTC/Pacific ambiguity).

const BASE_URL = 'https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443';

export async function scrapeEverett() {
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
  const sessions = [];

  for (const rink of data) {
    if (rink.name !== 'Community Rink') continue;
    for (const slot of rink.slots) {
      if (!/stick\s*(?:&|and)\s*puck/i.test(slot.title)) continue;
      const dateStr = slot.startDate.slice(0, 10);
      sessions.push({
        id: `everett-${slot.id}`,
        start: `${dateStr}T${slot.startTime}`,
        end:   `${dateStr}T${slot.endTime}`,
        title: slot.title,
        subtitle: null,
        spots: null,
        price: null,
        soldOut: false,
        bookUrl: 'https://aotw-arena.web.app/',
      });
    }
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}
