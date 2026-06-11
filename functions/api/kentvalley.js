// functions/api/kentvalley.js
// Cloudflare Pages Function — fetches Kent Valley stick & puck sessions via Google Calendar iCal.
// On fetch failure, serves the last good response from the Workers Cache API.

const ICAL_URL = 'https://calendar.google.com/calendar/ical/kentvalleyicecentre.com%40gmail.com/public/basic.ics';
const CACHE_KEY = new Request('https://cache.internal/postandin/kentvalley-v1');
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(ctx) {
  const cache = caches.default;

  try {
    const res = await fetch(ICAL_URL, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const sessions = parseIcal(await res.text());
    const body = JSON.stringify({ ok: true, sessions });

    // Persist the good response; don't block the reply waiting for the write.
    ctx.waitUntil(cache.put(CACHE_KEY, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })));

    return new Response(body, { headers: RESPONSE_HEADERS });

  } catch (e) {
    // Fall back to the last good cached payload, if any.
    const cached = await cache.match(CACHE_KEY);
    if (cached) {
      const data = await cached.json();
      return new Response(
        JSON.stringify({ ...data, stale: true }),
        { headers: RESPONSE_HEADERS },
      );
    }
    // Nothing cached yet — return the error so the UI can show it.
    return new Response(
      JSON.stringify({ ok: false, error: e.message, sessions: [] }),
      { status: 200, headers: RESPONSE_HEADERS },
    );
  }
}

function parseIcal(ical) {
  // Unfold continuation lines (RFC 5545 line folding)
  const text = ical.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');

  // Filter against yesterday (UTC) so client-side filtering handles the exact cutoff
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const cutoffStr = yesterday.toISOString().slice(0, 10);

  const sessions = [];
  const events = text.split('BEGIN:VEVENT');

  for (let i = 1; i < events.length; i++) {
    const block = events[i].split('END:VEVENT')[0];
    const props = {};

    for (const line of block.split('\n')) {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      const rawKey = line.slice(0, ci);
      const val = line.slice(ci + 1).trimEnd();
      // Strip parameters (e.g. DTSTART;TZID=America/Los_Angeles) to get base key
      const baseKey = rawKey.split(';')[0].toUpperCase();
      props[baseKey] = { val, isUtc: val.endsWith('Z') };
    }

    const summary = (props['SUMMARY']?.val ?? '').replace(/\\[,;nN]/g, ' ').trim();
    if (!/stick|s&p/i.test(summary)) continue;

    const dtstart = props['DTSTART'];
    const dtend   = props['DTEND'];
    if (!dtstart?.val?.includes('T')) continue; // skip all-day events

    const startStr = fmtDt(dtstart);
    const endStr   = dtend?.val?.includes('T') ? fmtDt(dtend) : null;

    if (startStr.slice(0, 10) < cutoffStr) continue;

    const uid    = props['UID']?.val ?? startStr;
    const urlVal = props['URL']?.val ?? '';
    const bookUrl = urlVal.startsWith('http') ? urlVal : 'https://kentvalleyicecentre.net/';

    sessions.push({
      id: uid,
      start: startStr,
      end: endStr,
      title: 'Stick & Puck',
      subtitle: null,
      spots: null,
      price: null,
      soldOut: false,
      bookUrl,
    });
  }

  return sessions.sort((a, b) => a.start.localeCompare(b.start));
}

function fmtDt({ val, isUtc }) {
  const s = val.replace('Z', '');
  const yr  = s.slice(0, 4);
  const mo  = s.slice(4, 6);
  const dy  = s.slice(6, 8);
  const hr  = s.slice(9, 11);
  const min = s.slice(11, 13);
  return `${yr}-${mo}-${dy}T${hr}:${min}:00${isUtc ? 'Z' : ''}`;
}
