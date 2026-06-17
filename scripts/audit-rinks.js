#!/usr/bin/env node
// scripts/audit-rinks.js
// Run with: node scripts/audit-rinks.js
//
// Periodically scans every rink's upstream data source for session/event
// names we might not be capturing as Stick & Puck. Prints anything new or
// unrecognized so a human can decide whether to add it.

const HOCKEY_HINTS = /stick|puck|hockey/i;
const EXCLUDE_HINTS = /gift card|lesson|figure|freestyle|speed skat|curling|broomball|birthday|public skate|punch card|video lab|skate helper|adult skate|membership/i;

// ── Known items/leagues already wired into stick-and-puck/index.html ──────
// Keep this list in sync manually when you add a new session.
const KNOWN = {
  fareharbor: {
    lynnwoodicecenter: [245296, 737473],
    olympicviewarena: [313860],
  },
  daysmart: {
    // DaySmart filters on description text ("stick", "full hockey gear"),
    // not league IDs, so just list league names already accounted for.
    kraken: ['Stick & Puck', 'LTP Family Stick & Puck (14 and under)',
             'Stick & Puck for female and non-binary identifying players only.'],
    snoking: [], // currently matched generically via sport filter + text
  },
  ical: {
    kentvalley: ['Stick & Puck'],
    everett: ['Stick & Puck'],
  },
};

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
  // Pull events for the next 30 days, collect unique league_ids, then resolve names.
  const today = new Date().toISOString().slice(0, 10);
  const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const eventsUrl = `https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/events?company=${companySlug}&filter[start__gte]=${today}&filter[start__lte]=${future}&page[size]=300`;
  const eventsData = await fetchJson(eventsUrl);
  const leagueIds = [...new Set(
    (eventsData.data ?? [])
      .filter(ev => ev.attributes?.event_type_id !== 'L') // skip locker room sub-events
      .map(ev => ev.attributes?.league_id)
      .filter(Boolean)
  )];

  const known = new Set(KNOWN.daysmart[companySlug] ?? []);
  const flagged = [];
  for (const id of leagueIds) {
    try {
      const ld = await fetchJson(`https://apps.daysmartrecreation.com/dash/jsonapi/api/v1/leagues/${id}?company=${companySlug}`);
      const name = ld?.data?.attributes?.name ?? '';
      if (known.has(name)) continue;
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

async function auditIcal(key, url) {
  const ical = await fetchText(url);
  const summaries = parseIcalSummaries(ical);
  const known = new Set(KNOWN.ical[key] ?? []);
  return summaries.filter(s => !known.has(s) && HOCKEY_HINTS.test(s) && !EXCLUDE_HINTS.test(s));
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

  // iCal feeds
  const icalFeeds = {
    kentvalley: 'https://calendar.google.com/calendar/ical/kentvalleyicecentre.com%40gmail.com/public/basic.ics',
    // Everett goes through the Cloudflare proxy normally, but for audit purposes
    // hit the upstream Cloud Function directly with a wide date range:
  };
  for (const [key, url] of Object.entries(icalFeeds)) {
    console.log(`── iCal: ${key} ──`);
    try {
      const flagged = await auditIcal(key, url);
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
  console.log('Anything flagged 🆕 above is NOT currently captured by stick-and-puck/index.html.');
  console.log('Update the KNOWN list in this script once you decide to add or ignore it.');
}

main().catch(e => {
  console.error('Audit script failed:', e);
  process.exit(1);
});
