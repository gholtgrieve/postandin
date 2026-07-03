// RecTimes scraper — extracted from functions/api/rectimes.js.
// Returns sessions as { id, start, end, title, subtitle, spots, price, soldOut, bookUrl }
// where start/end are Pacific local-time strings (no timezone suffix).

const BOOK_URLS = {
  1146: 'https://fareharbor.com/embeds/book/lynnwoodicecenter/items/245296/',
  1145: 'https://fareharbor.com/embeds/book/olympicviewarena/items/313860/',
};

export async function scrapeRecTimes({ venueId }) {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const futureDate = future.toISOString().slice(0, 10);
  const pacificNow = toPacificLocal(now.toISOString());

  const res = await fetch(
    'https://api.rectimes.com/api/v1/facilities/ova/bookings/get_for_calendar',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Referer': 'https://app.rectimes.com/' },
      body: JSON.stringify({
        venueIds: [venueId],
        startTimeLocal: `${today}T00:00:00Z`,
        endTimeLocal: `${futureDate}T00:00:00Z`,
      }),
    },
  );
  if (!res.ok) throw new Error(`RecTimes HTTP ${res.status}`);

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
