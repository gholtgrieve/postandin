// functions/api/kentvalley.js
// Cloudflare Pages Function — fetches Kent Valley stick & puck sessions via Google Calendar iCal.
// On fetch failure, serves the last good response from the Workers Cache API.
//
// The KVIC Google Calendar uses FREQ=WEEKLY recurring events for all sessions.
// This parser expands those recurrences, handles RECURRENCE-ID overrides
// (modified instances), and EXDATE exceptions.
//
// Timezone note: the feed mixes UTC-Z strings and local-time strings (no Z).
// UTC-Z values are converted to naive Pacific local strings via toPacificLocal
// so all emitted start/end values are comparable local-time strings.

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

    const { sessions, rawEventCount } = parseIcal(await res.text());
    const body = JSON.stringify({ ok: true, sessions, rawEventCount });

    ctx.waitUntil(cache.put(CACHE_KEY, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })));

    return new Response(body, { headers: RESPONSE_HEADERS });

  } catch (e) {
    const cached = await cache.match(CACHE_KEY);
    if (cached) {
      const data = await cached.json();
      return new Response(
        JSON.stringify({ ...data, stale: true }),
        { headers: RESPONSE_HEADERS },
      );
    }
    return new Response(
      JSON.stringify({ ok: false, error: e.message, sessions: [] }),
      { status: 200, headers: RESPONSE_HEADERS },
    );
  }
}

function parseIcal(ical) {
  const text = ical.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');

  const now     = new Date();
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days ahead
  const emitCutoff = new Date();

  const blocks = text.split('BEGIN:VEVENT');
  const rawEventCount = blocks.length - 1;

  const masters = [];
  const overridesByUid = new Map(); // uid → Map(normalised-recurrence-id → {startStr,endStr,bookUrl})
  const singles = [];

  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split('END:VEVENT')[0];
    const props   = {};
    const exdates = new Set();

    for (const line of block.split('\n')) {
      const ci = line.indexOf(':');
      if (ci === -1) continue;
      const rawKey  = line.slice(0, ci);
      const val     = line.slice(ci + 1).trimEnd();
      const baseKey = rawKey.split(';')[0].toUpperCase();
      if (baseKey === 'EXDATE') {
        for (const v of val.split(',')) {
          const s = v.replace('Z', '');
          if (s.length >= 8) exdates.add(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`);
        }
      } else {
        props[baseKey] = { val, isUtc: val.endsWith('Z') };
      }
    }

    const summary = (props['SUMMARY']?.val ?? '').replace(/\\[,;nN]/g, ' ').trim();
    if (!/stick|s&p/i.test(summary)) continue;

    const dtstart = props['DTSTART'];
    if (!dtstart?.val?.includes('T')) continue; // skip VALUE=DATE all-day events

    const dtend      = props['DTEND'];
    const uid        = props['UID']?.val ?? '';
    const rrule      = props['RRULE']?.val ?? null;
    const recurrProp = props['RECURRENCE-ID'];
    const urlVal     = props['URL']?.val ?? '';
    const bookUrl    = urlVal.startsWith('http') ? urlVal : 'https://kentvalleyicecentre.net/';

    const startStr = fmtDt(dtstart);
    const endStr   = dtend?.val?.includes('T') ? fmtDt(dtend) : null;

    if (recurrProp?.val?.includes('T')) {
      const recurrIdStr = fmtDt(recurrProp);
      if (!overridesByUid.has(uid)) overridesByUid.set(uid, new Map());
      overridesByUid.get(uid).set(recurrIdStr, { startStr, endStr, bookUrl });
    } else if (rrule) {
      masters.push({ startStr, endStr, rrule, uid, bookUrl, exdates });
    } else {
      singles.push({ startStr, endStr, uid, bookUrl });
    }
  }

  const sessions = [];
  const seen = new Set();
  const consumedOverrides = new Set();

  function emit(id, start, end, bookUrl) {
    if (seen.has(id)) return;
    seen.add(id);
    sessions.push({ id, start, end, title: 'Stick & Puck', subtitle: null,
                    spots: null, price: null, soldOut: false, bookUrl });
  }

  for (const ev of masters) {
    const uidOverrides = overridesByUid.get(ev.uid);
    for (const occ of expandRrule(ev.startStr, ev.endStr, ev.rrule, ev.exdates, now, horizon)) {
      const override = uidOverrides?.get(occ.startStr);
      if (override) consumedOverrides.add(`${ev.uid}:${occ.startStr}`);

      const rawStart = override?.startStr ?? occ.startStr;
      const rawEnd   = override?.endStr   ?? occ.endStr;
      const start = rawStart?.endsWith('Z') ? toPacificLocal(rawStart) : rawStart;
      const end   = rawEnd?.endsWith('Z')   ? toPacificLocal(rawEnd)   : rawEnd;
      if (new Date(rawEnd ?? rawStart) > emitCutoff) {
        emit(`${ev.uid}:${occ.startStr}`, start, end, override?.bookUrl ?? ev.bookUrl);
      }
    }
  }

  for (const ev of singles) {
    const sStart = ev.startStr?.endsWith('Z') ? toPacificLocal(ev.startStr) : ev.startStr;
    const sEnd   = ev.endStr?.endsWith('Z')   ? toPacificLocal(ev.endStr)   : ev.endStr;
    if (new Date(ev.endStr ?? ev.startStr) > emitCutoff) {
      emit(ev.uid || ev.startStr, sStart, sEnd, ev.bookUrl);
    }
  }

  // Override instances whose master wasn't found in the feed
  for (const [uid, uidOverrides] of overridesByUid) {
    for (const [recurrIdStr, ov] of uidOverrides) {
      if (consumedOverrides.has(`${uid}:${recurrIdStr}`)) continue;
      const oStart = ov.startStr?.endsWith('Z') ? toPacificLocal(ov.startStr) : ov.startStr;
      const oEnd   = ov.endStr?.endsWith('Z')   ? toPacificLocal(ov.endStr)   : ov.endStr;
      if (new Date(ov.endStr ?? ov.startStr) > emitCutoff) {
        emit(`orphan:${uid}:${ov.startStr}`, oStart, oEnd, ov.bookUrl);
      }
    }
  }

  return { sessions: sessions.sort((a, b) => a.start.localeCompare(b.start)), rawEventCount };
}

// Expand a FREQ=WEEKLY rule into occurrences between (now-12h) and horizon.
// Jumps directly to the occurrence nearest to now rather than iterating
// from the series start, so series from years ago are handled efficiently.
function expandRrule(startStr, endStr, rrule, exdates, now, horizon) {
  const params = {};
  for (const part of rrule.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1) params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (params.FREQ !== 'WEEKLY') return [];

  const until      = params.UNTIL ? parseIcalDt(params.UNTIL) : null;
  const isUtcStart = startStr.endsWith('Z');
  const isUtcEnd   = endStr?.endsWith('Z') ?? false;
  const startMs    = new Date(startStr).getTime();
  const durMs      = endStr ? new Date(endStr).getTime() - startMs : 0;
  const weekMs     = 7 * 24 * 60 * 60 * 1000;

  const count      = params.COUNT ? parseInt(params.COUNT, 10) : null;
  const countUntil = count ? new Date(startMs + (count - 1) * weekMs) : null;
  const limit      = [until, countUntil, horizon].filter(Boolean).reduce((a, b) => a < b ? a : b);

  // Jump to the occurrence at or just before (now - 12 h) to capture
  // local-time sessions that appear earlier than they actually are in UTC.
  const windowStart   = now.getTime() - 12 * 60 * 60 * 1000;
  const weeksElapsed  = Math.max(0, Math.floor((windowStart - startMs) / weekMs));
  const firstT        = startMs + weeksElapsed * weekMs;

  const occurrences = [];
  for (let t = firstT; ; t += weekMs) {
    const d = new Date(t);
    if (d > limit) break;
    const occStart = fmtDateFrom(d, isUtcStart);
    if (exdates.has(occStart.slice(0, 10))) continue;
    occurrences.push({
      startStr: occStart,
      endStr:   endStr ? fmtDateFrom(new Date(t + durMs), isUtcEnd) : null,
    });
  }
  return occurrences;
}

// Parse an iCal UNTIL / EXDATE datetime string to a JS Date.
function parseIcalDt(s) {
  const isUtc = s.endsWith('Z');
  const c = s.replace('Z', '');
  if (c.length === 8) {
    return new Date(`${c.slice(0,4)}-${c.slice(4,6)}-${c.slice(6,8)}`);
  }
  const yr = c.slice(0,4), mo = c.slice(4,6), dy = c.slice(6,8);
  const hr = c.slice(9,11), mn = c.slice(11,13), sc = c.slice(13,15) || '00';
  return new Date(`${yr}-${mo}-${dy}T${hr}:${mn}:${sc}${isUtc ? 'Z' : ''}`);
}

// Reformat a JS Date into the same no-timezone shape as fmtDt output.
// Uses UTC accessors — on this UTC Worker getUTC* === get*.
function fmtDateFrom(d, isUtc) {
  if (isUtc) return d.toISOString().slice(0, 16) + ':00Z';
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const hr = String(d.getUTCHours()).padStart(2, '0');
  const mn = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yr}-${mo}-${dy}T${hr}:${mn}:00`;
}

// Convert a UTC-Z ISO string to a naive Pacific local datetime string.
function toPacificLocal(isoStr) {
  if (!isoStr) return null;
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

// Convert a raw iCal DTSTART/DTEND/RECURRENCE-ID value to a normalised string.
function fmtDt({ val, isUtc }) {
  const s  = val.replace('Z', '');
  const yr = s.slice(0, 4), mo = s.slice(4, 6), dy = s.slice(6, 8);
  const hr = s.slice(9, 11), mn = s.slice(11, 13);
  return `${yr}-${mo}-${dy}T${hr}:${mn}:00${isUtc ? 'Z' : ''}`;
}
