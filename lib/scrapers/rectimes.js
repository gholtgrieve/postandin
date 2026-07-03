// RecTimes scraper — extracted from functions/api/rectimes.js.
// Returns sessions as { id, start, end, title, subtitle, spots, price, soldOut, bookUrl }
// where start/end are Pacific local-time strings (no timezone suffix).

const BOOK_URLS = {
  1146: 'https://fareharbor.com/embeds/book/lynnwoodicecenter/items/245296/',
  1145: 'https://fareharbor.com/embeds/book/olympicviewarena/items/313860/',
};

export async function scrapeRecTimes({ venueId }, { jitter = false } = {}) {
  if (jitter) {
    // Spread cron-triggered RecTimes calls across a random 2-5 minute window
    // so the request pattern doesn't look like a fixed bot schedule.
    await sleep(2 * 60_000 + Math.random() * 3 * 60_000);
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const futureDate = future.toISOString().slice(0, 10);
  const pacificNow = toPacificLocal(now.toISOString());

  const body = JSON.stringify({
    venueIds: [venueId],
    startTimeLocal: `${today}T00:00:00Z`,
    endTimeLocal: `${futureDate}T00:00:00Z`,
  });
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://app.rectimes.com',
    'Referer': 'https://app.rectimes.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  };
  const url = 'https://api.rectimes.com/api/v1/facilities/ova/bookings/get_for_calendar';

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`RecTimes HTTP ${res.status}`);
  } catch (e) {
    // One retry after a short delay, in case this is a transient/soft rate limit.
    await sleep(1500 + Math.random() * 1000);
    res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) throw new Error(`RecTimes HTTP ${res.status}`);
  }

  const data = await res.json();
  const bookings = Array.isArray(data) ? data : (data?.bookings ?? []);

  return bookings
    .filter(b => /stick\s*(?:&|and)\s*puck/i.test(b.groupName ?? ''))
    .filter(b => (b.endTimeLocal ?? b.startTimeLocal) > pacificNow)
    .map(b => ({
      id: String(b.id ?? b.bookingId ?? b.startTimeLocal),
      start: b.startTimeLocal,
      end: b.endTimeLocal ?? null,
      title: b.groupName,
      subtitle: null,
      spots: null,
      price: null,
      soldOut: false,
      bookUrl: BOOK_URLS[venueId] ?? 'https://app.rectimes.com/ova',
    }));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toPacificLocal(isoStr) {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
