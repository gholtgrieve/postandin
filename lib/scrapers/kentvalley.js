// Kent Valley iCal scraper — extracted from functions/api/kentvalley.js.
// Returns { sessions: [...], rawEventCount: number } across the requested
// activity-specific calendars.
// Sessions have start/end as ISO strings (UTC-Z or naive Pacific local).

import {
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  activitySet,
  eligibility,
} from '../activities.js';

export const ICAL_URLS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: 'https://calendar.google.com/calendar/ical/kentvalleyicecentre.com%40gmail.com/public/basic.ics',
  [ACTIVITY_PUBLIC_SKATE]: 'https://calendar.google.com/calendar/ical/juvuejlh2bvf020bhbe4m2h2og%40group.calendar.google.com/public/basic.ics',
});

const ACTIVITY_DETAILS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: Object.freeze({
    title: 'Stick & Puck',
    matches: summary => /stick|s&p/i.test(summary),
    fallbackUrl: 'https://kentvalleyicecentre.net/hockey/',
  }),
  [ACTIVITY_PUBLIC_SKATE]: Object.freeze({
    title: 'Public Skate',
    matches: summary => /public\s+(?:ice\s+)?skat(?:e|ing)|holiday\s+skat(?:e|ing)/i.test(summary),
    fallbackUrl: 'https://kentvalleyicecentre.net/public-ice-skating/',
  }),
});

export async function scrapeKentValley({ activities } = {}) {
  const requested = activitySet(activities);
  const feedActivities = [...requested]
    .filter(activity => ICAL_URLS[activity])
  const settled = await Promise.allSettled(feedActivities.map(async activity => {
      const ical = await fetchIcal(ICAL_URLS[activity]);
      return parseIcal(ical, { activity });
    }));
  const results = settled
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value);
  const failures = settled.flatMap((result, index) =>
    result.status === 'rejected' ? [feedActivities[index]] : []
  );
  settled.forEach((result, index) => {
    if (result.status === 'rejected') {
      console.error(
        `Kent Valley ${feedActivities[index]} calendar failed:`,
        result.reason?.message,
        result.reason?.stack,
      );
    }
  });
  return {
    sessions: results.flatMap(result => result.sessions)
      .sort((a, b) => a.start.localeCompare(b.start)),
    rawEventCount: results.reduce((sum, result) => sum + result.rawEventCount, 0),
    attempted: feedActivities,
    failures,
  };
}

async function fetchIcal(url) {
  // The public .ics contains the calendar's full history and can be slow to
  // download, so allow a generous timeout and one retry on transient failure.
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  } catch (e) {
    await sleep(1500 + Math.random() * 1000);
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
  }
  return res.text();
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function parseIcal(ical, {
  now = new Date(),
  activity = ACTIVITY_STICK_AND_PUCK,
} = {}) {
  const details = ACTIVITY_DETAILS[activity];
  if (!details) throw new Error(`Unsupported Kent Valley activity: ${activity}`);
  const text = ical.replace(/\r\n[ \t]/g, '').replace(/\r/g, '');

  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const emitCutoff = now;
  const emitCutoffPacific = toPacificLocal(emitCutoff.toISOString());
  const horizonPacific = toPacificLocal(horizon.toISOString());
  const isWithinWindow = (rawStart, rawEnd) => {
    if (!rawStart) return false;
    const effectiveEnd = rawEnd ?? rawStart;
    const afterNow = effectiveEnd.endsWith('Z')
      ? new Date(effectiveEnd) > emitCutoff
      : effectiveEnd > emitCutoffPacific;
    const beforeHorizon = rawStart.endsWith('Z')
      ? new Date(rawStart) <= horizon
      : rawStart <= horizonPacific;
    return afterNow && beforeHorizon;
  };

  const blocks = text.split('BEGIN:VEVENT');
  const rawEventCount = blocks.length - 1;

  const masters = [];
  const overridesByUid = new Map();
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

    const cancelled = props['STATUS']?.val?.toUpperCase() === 'CANCELLED';
    const dtstart = props['DTSTART'];
    if (!dtstart?.val?.includes('T')) continue;
    const dtend      = props['DTEND'];
    const uid        = props['UID']?.val ?? '';
    const rrule      = props['RRULE']?.val ?? null;
    const recurrProp = props['RECURRENCE-ID'];
    const urlVal     = props['URL']?.val ?? '';
    const bookUrl    = urlVal.startsWith('http') ? urlVal : details.fallbackUrl;

    const startStr = fmtDt(dtstart);
    const endStr   = dtend?.val?.includes('T') ? fmtDt(dtend) : null;
    const recurrIdStr = recurrProp?.val?.includes('T') ? fmtDt(recurrProp) : null;

    // Google Calendar cancellation overrides may omit SUMMARY. Preserve them
    // so they can still suppress the matching occurrence from an accepted
    // recurring master in this activity-specific feed.
    if (cancelled && recurrIdStr) {
      if (!overridesByUid.has(uid)) overridesByUid.set(uid, new Map());
      overridesByUid.get(uid).set(recurrIdStr, {
        startStr, endStr, bookUrl, cancelled, recurrIdStr,
      });
      continue;
    }

    const summary = (props['SUMMARY']?.val ?? '').replace(/\\[,;nN]/g, ' ').trim();
    if (!details.matches(summary) || cancelled) continue;

    if (recurrIdStr) {
      if (!overridesByUid.has(uid)) overridesByUid.set(uid, new Map());
      overridesByUid.get(uid).set(recurrIdStr, {
        startStr, endStr, bookUrl, cancelled: false, recurrIdStr,
      });
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
    sessions.push({ id, start, end, title: details.title, subtitle: null,
                    spots: null, price: null, soldOut: false, bookUrl,
                    activity,
                    sourceLabel: details.title,
                    eligibility: eligibility(),
                    registration: {
                      required: null, method: null, capacity: null, spots: null,
                      goalieSpots: null, roles: {},
                    },
                    cancelled: false });
  }

  for (const ev of masters) {
    const uidOverrides = overridesByUid.get(ev.uid);
    for (const occ of expandRrule(ev.startStr, ev.endStr, ev.rrule, ev.exdates, now, horizon)) {
      const override = uidOverrides?.get(occ.startStr);
      if (override) consumedOverrides.add(`${ev.uid}:${occ.startStr}`);
      if (override?.cancelled) continue;

      const rawStart = override?.startStr ?? occ.startStr;
      const rawEnd   = override?.endStr   ?? occ.endStr;
      const start = rawStart?.endsWith('Z') ? toPacificLocal(rawStart) : rawStart;
      const end   = rawEnd?.endsWith('Z')   ? toPacificLocal(rawEnd)   : rawEnd;
      if (isWithinWindow(rawStart, rawEnd)) {
        emit(`${ev.uid}:${occ.startStr}`, start, end, override?.bookUrl ?? ev.bookUrl);
      }
    }
  }

  for (const ev of singles) {
    const sStart = ev.startStr?.endsWith('Z') ? toPacificLocal(ev.startStr) : ev.startStr;
    const sEnd   = ev.endStr?.endsWith('Z')   ? toPacificLocal(ev.endStr)   : ev.endStr;
    if (isWithinWindow(ev.startStr, ev.endStr)) {
      emit(ev.uid || ev.startStr, sStart, sEnd, ev.bookUrl);
    }
  }

  for (const [uid, uidOverrides] of overridesByUid) {
    for (const [recurrIdStr, ov] of uidOverrides) {
      if (consumedOverrides.has(`${uid}:${recurrIdStr}`)) continue;
      if (ov.cancelled) continue;
      const oStart = ov.startStr?.endsWith('Z') ? toPacificLocal(ov.startStr) : ov.startStr;
      const oEnd   = ov.endStr?.endsWith('Z')   ? toPacificLocal(ov.endStr)   : ov.endStr;
      if (isWithinWindow(ov.startStr, ov.endStr)) {
        emit(`${uid}:${ov.recurrIdStr}`, oStart, oEnd, ov.bookUrl);
      }
    }
  }

  return { sessions: sessions.sort((a, b) => a.start.localeCompare(b.start)), rawEventCount };
}

function expandRrule(startStr, endStr, rrule, exdates, now, horizon) {
  const params = {};
  for (const part of rrule.split(';')) {
    const eq = part.indexOf('=');
    if (eq !== -1) params[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (params.FREQ !== 'WEEKLY') return [];

  const isUtcStart = startStr.endsWith('Z');
  const isUtcEnd   = endStr?.endsWith('Z') ?? false;
  // Treat naive timestamps as calendar-local wall time on a synthetic UTC
  // timeline. Parsing them as host-local Date values and then reading UTC
  // fields shifts Pacific recurring events by seven or eight hours.
  const timelineDate = value => {
    if (isUtcStart) return new Date(value);
    const localValue = value.endsWith?.('Z') ? toPacificLocal(value) : value;
    return parseNaiveAsUtc(localValue);
  };
  const until      = params.UNTIL ? timelineDate(fmtRawIcalDt(params.UNTIL)) : null;
  const startMs    = timelineDate(startStr).getTime();
  const durMs      = endStr ? timelineDate(endStr).getTime() - startMs : 0;
  const weekMs     = 7 * 24 * 60 * 60 * 1000;

  const count      = params.COUNT ? parseInt(params.COUNT, 10) : null;
  const countUntil = count ? new Date(startMs + (count - 1) * weekMs) : null;
  const timelineNow = isUtcStart
    ? now
    : parseNaiveAsUtc(toPacificLocal(now.toISOString()));
  const timelineHorizon = isUtcStart
    ? horizon
    : new Date(timelineNow.getTime() + 30 * 24 * 60 * 60 * 1000);
  const limit      = [until, countUntil, timelineHorizon].filter(Boolean).reduce((a, b) => a < b ? a : b);

  const windowStart   = timelineNow.getTime() - 12 * 60 * 60 * 1000;
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

function fmtRawIcalDt(value) {
  const isUtc = value.endsWith('Z');
  const s = value.replace('Z', '');
  if (s.length === 8) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(9,11)}:${s.slice(11,13)}:${s.slice(13,15) || '00'}${isUtc ? 'Z' : ''}`;
}

function parseNaiveAsUtc(value) {
  return new Date(`${value.replace(/Z$/, '')}Z`);
}

function fmtDateFrom(d, isUtc) {
  if (isUtc) return d.toISOString().slice(0, 16) + ':00Z';
  const yr = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dy = String(d.getUTCDate()).padStart(2, '0');
  const hr = String(d.getUTCHours()).padStart(2, '0');
  const mn = String(d.getUTCMinutes()).padStart(2, '0');
  return `${yr}-${mo}-${dy}T${hr}:${mn}:00`;
}

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

function fmtDt({ val, isUtc }) {
  const s  = val.replace('Z', '');
  const yr = s.slice(0, 4), mo = s.slice(4, 6), dy = s.slice(6, 8);
  const hr = s.slice(9, 11), mn = s.slice(11, 13);
  return `${yr}-${mo}-${dy}T${hr}:${mn}:00${isUtc ? 'Z' : ''}`;
}
