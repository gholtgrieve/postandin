#!/usr/bin/env node
// scripts/audit-rinks.js
// Run with: node scripts/audit-rinks.js
//
// Periodically scans every rink's upstream data source for session/event
// names we might not be capturing as an approved ice-time activity. Prints anything new or
// unrecognized so a human can decide whether to add it.

import {
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  DAYSMART_DROP_IN_LABELS,
  DAYSMART_EXCLUDED_DROP_IN_LABELS,
  EVERETT_DROP_IN_LABELS,
  EVERETT_PUBLIC_SKATE_LABELS,
  RECTIMES_PUBLIC_SKATE_LABELS,
} from '../lib/activities.js';
import { ICAL_URLS } from '../lib/scrapers/kentvalley.js';
import { EVERETT_SHEETS } from '../lib/scrapers/everett.js';
import { pathToFileURL } from 'node:url';

const HOCKEY_HINTS = /stick|puck|hockey|drop.?in|pickup|shinny|rat hockey/i;
// Do not globally exclude "learn to play": an approved Sno-King 3v3 drop-in
// uses that wording, so future variants must reach human review.
const EXCLUDE_HINTS = /gift card|lesson|try hockey|camp|figure|freestyle|speed skat|curling|broomball|birthday|public skate|punch card|video lab|skate helper|adult skate|membership/i;
const PUBLIC_SKATE_HINTS = /public\s+(?:ice\s+)?skat(?:e|ing|es|session)|adult skate|friday night skates/i;

// ── Known items/leagues already handled by lib/scrapers/*.js ─────────────
// Keep this list in sync manually when you add a new session.
const KNOWN = {
  fareharbor: {
    lynnwoodicecenter: [245296, 380350, 737473],
    olympicviewarena: [313860, 283939],
  },
  daysmart: {
    // DaySmart filters on description text ("stick", "full hockey gear"),
    // not league IDs, so just list league names already accounted for.
    kraken: [
      'Stick & Puck',
      'LTP Family Stick & Puck (14 and under)',
      'Stick & Puck for female and non-binary identifying players only.',
      'Stick & Puck (Female only)',
      'KSA/KYHA - Prep Hockey (Session #5)',
      'KSA/KYHA - Prep Hockey (Fall)',
      ...DAYSMART_DROP_IN_LABELS.kraken,
      ...DAYSMART_EXCLUDED_DROP_IN_LABELS.kraken,
    ],
    snoking: [
      ...DAYSMART_DROP_IN_LABELS.snoking,
      ...DAYSMART_EXCLUDED_DROP_IN_LABELS.snoking,
    ],
  },
  daysmartPublic: {
    kraken: ['Public Skate'],
    snoking: ['Public Skate'],
  },
  ical: {
    // Historical one-off typo from 2024; production's 30-day window never
    // reaches it, but the full-history audit feed does.
    kentValley: ['Open Stic & Puck'],
    // Legacy full-history labels. These are not accepted by the production
    // Public Skate classifier unless they match a reviewed pattern below.
    kentValleyPublic: [
      '4:00pm-5:30pm Public',
      '7pm-8pm Cheap Skate Session',
      '7pm - 8pm Cheap Skate Session',
      '4:15pm-5:15pm Cheap Skate',
      '7:00pm-8:00pm Cheap Skate Public Session',
      '7:00pm-8:00pm Cheap Skate Session',
      '12:30pm-2:00pm Public',
      '12:45pm-2:15pm Public',
      'Cheap Skate Session',
      '1:45pm-3:15pm Public',
      '2:30pm-4:00pm Public',
      '4:15pm-5:15pmPublic-cheapskate',
      '3:30pm-5:00pm Public',
      'Public Session',
      '10:15am - 11:45am Public',
      '10:15am-11:45am Public',
      '4:15pm - 5:15pm Public (Cheapskate)',
    ],
  },
};

// Regex patterns for league names that are already captured but vary over time
// (e.g. monthly-named Sno-King leagues). Checked in addition to KNOWN.daysmart.
const KNOWN_PATTERNS = {
  snoking: [
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w* - stick n puck$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w* - rookies stick n puck$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w* - rookies stick n puck$/i,
  ],
  kentValley: [
    /stick\s*(?:&|and|n[’']?)\s*puck/i,
    /(?:adult|adults|cross ice adult)\s+drop.?in(?:\s+hockey)?/i,
    /\blearn to play hockey(?: classes)?$/i,
  ],
  kentValleyPublic: [
    /public\s+(?:ice\s+)?skat(?:e|ing)/i,
    /holiday\s+skat(?:e|ing)/i,
  ],
  everett: [
    /^🏒 Adult Hockey Skating\b/i,
    /^🏒⚡ Advanced Hockey: Power Skating\b/i,
    /^🏒 Hockey Tots\b/i,
    /^🏒 Hockey 1-4\b/i,
  ],
};

export function isKnownEverettInstruction(title) {
  return KNOWN_PATTERNS.everett.some(pattern => pattern.test(title));
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.text();
}

// ── FareHarbor: list every bookable item per company ──────────────────────
async function auditFareHarbor(companySlug) {
  const url = `https://fareharbor.com/api/v1/companies/${companySlug}/items/`;
  const data = await fetchJson(url);
  const items = data.items ?? data;
  const known = new Set(KNOWN.fareharbor[companySlug] ?? []);
  const flagged = [];
  for (const item of items) {
    const name = item.name ?? '';
    if (known.has(item.pk)) continue;
    if (EXCLUDE_HINTS.test(name)) continue;
    if (HOCKEY_HINTS.test(name)) {
      flagged.push({ pk: item.pk, name });
    }
  }
  return flagged;
}

// ── DaySmart: list every league per company, flag unrecognized hockey-ish names ──
async function auditDaySmart(companySlug) {
  // Match the production hockey sport and use 45 days to catch less-frequent
  // sessions before an exact allowlist silently misses them.
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const eventsUrl = `https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?company=${companySlug}&filter[homeTeam.sport_id__in]=20&filter[start__gte]=${today}&filter[start__lte]=${future}&page[size]=500`;
  const eventsData = await fetchJson(eventsUrl);
  const leagueIds = [...new Set(
    (eventsData.data ?? [])
      .filter(ev => ev.attributes?.event_type_id !== 'L') // skip locker room sub-events
      .map(ev => ev.attributes?.league_id)
      .filter(Boolean)
  )];

  const known = new Set(KNOWN.daysmart[companySlug] ?? []);
  const patterns = KNOWN_PATTERNS[companySlug] ?? [];
  const flagged = [];
  for (const id of leagueIds) {
    try {
      const ld = await fetchJson(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/leagues/${id}?company=${companySlug}`);
      const name = ld?.data?.attributes?.name ?? '';
      if (known.has(name)) continue;
      if (patterns.some(re => re.test(name))) continue;
      if (EXCLUDE_HINTS.test(name)) continue;
      if (HOCKEY_HINTS.test(name)) {
        flagged.push({ leagueId: id, name });
      }
    } catch (e) {
      flagged.push({ leagueId: id, error: e.message });
    }
  }
  return flagged;
}

async function auditDaySmartPublic(companySlug) {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const eventFilter = companySlug === 'snoking'
    ? 'filter[event_type_id]=12'
    : 'filter[homeTeam.sport_id__in]=30';
  const eventsData = await fetchJson(
    `https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?company=${companySlug}&${eventFilter}&filter[start__gte]=${today}&filter[start__lte]=${future}&page[size]=500`,
  );
  const events = (eventsData.data ?? [])
    .filter(event => event.attributes?.event_type_id !== 'L');
  const names = new Set();

  if (companySlug === 'snoking') {
    for (const event of events) names.add(event.attributes?.desc ?? '');
  } else {
    const leagueIds = [...new Set(events
      .map(event => event.attributes?.league_id)
      .filter(Boolean))];
    for (const id of leagueIds) {
      const league = await fetchJson(
        `https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/leagues/${id}?company=${companySlug}`,
      );
      names.add(league?.data?.attributes?.name ?? '');
    }
  }

  const known = new Set(KNOWN.daysmartPublic[companySlug] ?? []);
  return {
    count: events.length,
    flagged: [...names].filter(name => name && !known.has(name)),
  };
}

async function auditRecTimesPublic() {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 45 * 86400000).toISOString().slice(0, 10);
  const res = await fetch('https://api.rectimes.com/api/v1/facilities/ova/bookings/get_for_calendar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://app.rectimes.com',
      'Referer': 'https://app.rectimes.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    body: JSON.stringify({
      venueIds: [1145, 1146],
      startTimeLocal: `${today}T00:00:00Z`,
      endTimeLocal: `${future}T00:00:00Z`,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const bookings = Array.isArray(data) ? data : (data.bookings ?? []);
  const expectedExclusions = new Set(['1145:Adult Skate', '1145:Friday Night Skates']);
  const flagged = [];
  const counts = { 1145: 0, 1146: 0 };
  for (const booking of bookings) {
    const venueId = Number(booking.venueId ?? booking.venue_id);
    const name = booking.groupName ?? '';
    if (RECTIMES_PUBLIC_SKATE_LABELS[venueId]?.includes(name)) {
      counts[venueId] = (counts[venueId] ?? 0) + 1;
      continue;
    }
    if (expectedExclusions.has(`${venueId}:${name}`)) continue;
    if (PUBLIC_SKATE_HINTS.test(name)) flagged.push({ venueId, name });
  }
  return { counts, flagged };
}

async function auditEverettPublic() {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const data = await fetchJson(
    `https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443?startDate=${today}&endDate=${future}`
  );
  const titles = data
    .filter(rink => EVERETT_SHEETS.includes(rink.name))
    .flatMap(rink => rink.slots ?? [])
    .map(slot => slot.title ?? '');
  return {
    count: titles.filter(title => EVERETT_PUBLIC_SKATE_LABELS.includes(title)).length,
    flagged: [...new Set(titles.filter(title =>
      PUBLIC_SKATE_HINTS.test(title) &&
      !EVERETT_PUBLIC_SKATE_LABELS.includes(title)
    ))],
  };
}

// ── iCal feeds: dump unique SUMMARY values, flag unrecognized ones ────────
function parseIcalSummaries(ical) {
  const blocks = ical.split('BEGIN:VEVENT').slice(1);
  const summaries = new Set();
  for (const block of blocks) {
    const m = block.match(/^SUMMARY:(.+)$/m);
    if (m) summaries.add(m[1].trim());
  }
  return [...summaries];
}

async function auditIcal(
  key,
  url,
  { hints = HOCKEY_HINTS, excludes = EXCLUDE_HINTS } = {},
) {
  const ical = await fetchText(url);
  const summaries = parseIcalSummaries(ical);
  const known = new Set(KNOWN.ical[key] ?? []);
  const patterns = KNOWN_PATTERNS[key] ?? [];
  return summaries.filter(s =>
    !known.has(s) &&
    !patterns.some(re => re.test(s)) &&
    hints.test(s) &&
    !excludes.test(s)
  );
}

async function auditEverett() {
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const data = await fetchJson(
    `https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443?startDate=${today}&endDate=${future}`
  );
  const titles = new Set(
    data
      .filter(rink => EVERETT_SHEETS.includes(rink.name))
      .flatMap(rink => rink.slots ?? [])
      .map(slot => slot.title ?? '')
  );
  return [...titles].filter(title =>
    !isKnownEverettInstruction(title) &&
    !EVERETT_DROP_IN_LABELS.includes(title) &&
    !/stick\s*(?:&|and)\s*puck/i.test(title) &&
    !/^KHL-/i.test(title) &&
    HOCKEY_HINTS.test(title) &&
    !EXCLUDE_HINTS.test(title)
  );
}

// ── Run everything ──────────────────────────────────────────────────────
async function main() {
  console.log('═══ Post & In — Rink Session Audit ═══\n');

  // FareHarbor
  for (const slug of Object.keys(KNOWN.fareharbor)) {
    console.log(`── FareHarbor: ${slug} ──`);
    try {
      const flagged = await auditFareHarbor(slug);
      if (flagged.length === 0) {
        console.log('  ✅ No new hockey-related items found.\n');
      } else {
        for (const f of flagged) console.log(`  🆕 pk=${f.pk}  "${f.name}"`);
        console.log('');
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }

  // DaySmart
  for (const slug of Object.keys(KNOWN.daysmart)) {
    console.log(`── DaySmart: ${slug} ──`);
    try {
      const flagged = await auditDaySmart(slug);
      if (flagged.length === 0) {
        console.log('  ✅ No new hockey-related leagues found.\n');
      } else {
        for (const f of flagged) {
          if (f.error) console.log(`  ⚠️  league ${f.leagueId}: ${f.error}`);
          else console.log(`  🆕 league ${f.leagueId}  "${f.name}"`);
        }
        console.log('');
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }

  for (const slug of Object.keys(KNOWN.daysmartPublic)) {
    console.log(`── DaySmart Public Skate: ${slug} ──`);
    try {
      const { count, flagged } = await auditDaySmartPublic(slug);
      if (flagged.length === 0) {
        console.log(`  ✅ ${count} sessions; no new Public Skate labels found.\n`);
      } else {
        for (const name of flagged) console.log(`  🆕 "${name}"`);
        console.log('');
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }

  console.log('── RecTimes Public Skate ──');
  try {
    const { counts, flagged } = await auditRecTimesPublic();
    if (flagged.length === 0) {
      console.log(`  ✅ Olympic View ${counts[1145]} · Lynnwood ${counts[1146]}; no new labels found.\n`);
    } else {
      for (const item of flagged) console.log(`  🆕 venue ${item.venueId} "${item.name}"`);
      console.log('');
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }

  console.log('── Everett Public Skate ──');
  try {
    const { count, flagged } = await auditEverettPublic();
    if (flagged.length === 0) {
      console.log(`  ✅ ${count} sessions across Main and Community rinks; no new labels found.\n`);
    } else {
      for (const title of flagged) console.log(`  🆕 "${title}"`);
      console.log('');
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }

  console.log('── Everett calendar ──');
  try {
    const flagged = await auditEverett();
    if (flagged.length === 0) {
      console.log('  ✅ No new hockey-related titles found.\n');
    } else {
      for (const title of flagged) console.log(`  🆕 "${title}"`);
      console.log('');
    }
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}\n`);
  }

  // iCal feeds
  const icalFeeds = {
    kentValley: { url: ICAL_URLS[ACTIVITY_STICK_AND_PUCK] },
    kentValleyPublic: {
      url: ICAL_URLS[ACTIVITY_PUBLIC_SKATE],
      options: {
        hints: /public|holiday|black.?light|cheap\s+skate/i,
        excludes: /$^/,
      },
    },
  };
  for (const [key, { url, options }] of Object.entries(icalFeeds)) {
    console.log(`── iCal: ${key} ──`);
    try {
      const flagged = await auditIcal(key, url, options);
      if (flagged.length === 0) {
        console.log('  ✅ No new event titles found.\n');
      } else {
        for (const f of flagged) console.log(`  🆕 "${f}"`);
        console.log('');
      }
    } catch (e) {
      console.log(`  ❌ Error: ${e.message}\n`);
    }
  }

  console.log('═══ Audit complete ═══');
  console.log('Anything flagged 🆕 above is not yet accounted for by the audit expectations.');
  console.log('Verify the production classifier, then update it or the KNOWN list after review.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => {
    console.error('Audit script failed:', e);
    process.exit(1);
  });
}
