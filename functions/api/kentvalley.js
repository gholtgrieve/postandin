// functions/api/kentvalley.js
// Cloudflare Pages Function — fetches Kent Valley stick & puck sessions via Google Calendar iCal.

export async function onRequest() {
  const ICAL_URL = 'https://calendar.google.com/calendar/ical/kentvalleyicecentre.com%40gmail.com/public/basic.ics';
  const HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(ICAL_URL, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'HTTP ' + res.status, sessions: [] }), { status: 200, headers: HEADERS });
    }

    const ical = await res.text();
    const sessions = parseIcal(ical);
    return new Response(JSON.stringify({ ok: true, sessions }), { headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, sessions: [] }), { status: 200, headers: HEADERS });
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
