// Scheduler Worker — runs two independent cron jobs:
//
//  1. Schedule caches (every 30 min): scrapes all rinks once, writes Stick &
//     Puck to schedule:cache, Drop-in Hockey to
//     schedule:cache:drop-in-hockey, and Public Skate to
//     schedule:cache:public-skate. The Pages Function defaults to the legacy
//     Stick & Puck key.
//  2. GROUPS backup (daily, ~3am Pacific): full export of the GROUPS KV
//     namespace to R2. See src/backup.js.
//
// Manual triggers require POST and the ADMIN_TRIGGER_TOKEN bearer secret.
// See scheduler/README.md. Never include the token in a URL or logs.

import { scrapeAll } from '../../lib/scrapeAll.js';
import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  SUPPORTED_ACTIVITIES,
} from '../../lib/activities.js';
import { SCHEDULE_CACHE_KEYS, SCHEDULE_RETENTION_SECONDS } from '../../lib/scheduleCache.js';
import { backupGroups } from './backup.js';
import { handleManualRequest } from './manual.js';

export { SCHEDULE_CACHE_KEYS } from '../../lib/scheduleCache.js';

const BACKUP_CRON = '0 10 * * *';
const MAX_CARRY_MS = 24 * 60 * 60 * 1000;

export default {
  async scheduled(event, env, ctx) {
    if (event.cron === BACKUP_CRON) {
      ctx.waitUntil(backupGroups(env));
      return;
    }
    // Real cron firing: jitter the RecTimes calls so they don't look like a
    // fixed bot schedule to RecTimes' bot detection.
    ctx.waitUntil(runScrape(env, { jitterRecTimes: true }));
  },

  async fetch(req, env) {
    return handleManualRequest(req, env, { scrape: runScrape, backup: backupGroups });
  },
};

async function runScrape(env, opts = {}) {
  const data = await scrapeAll({ ...opts, activities: SUPPORTED_ACTIVITIES });
  await writeScheduleCaches(env, data);
}

export async function writeScheduleCaches(env, data, { now = new Date() } = {}) {
  const anyOk = Object.values(data).some(r => r.ok);
  if (!anyOk) {
    console.error('runScrape: every rink failed this run — keeping existing schedule caches instead of overwriting them with an all-failed payload');
    return { updated: false };
  }

  const fetchedAt = now.toISOString();

  // Write activity-specific caches first. The legacy Stick & Puck key is
  // written last and keeps its exact response shape for /api/schedule.
  const writeOrder = [
    ACTIVITY_PUBLIC_SKATE,
    ACTIVITY_DROP_IN_HOCKEY,
    ACTIVITY_STICK_AND_PUCK,
  ];
  for (const activity of writeOrder) {
    const cacheKey = SCHEDULE_CACHE_KEYS[activity];
    const current = selectActivity(data, activity);
    const prev = await env.SCHEDULE.get(cacheKey, { type: 'json' });
    const merged = carryLastKnownGood(current, prev, now.getTime(), activity);
    const payload = JSON.stringify({ fetchedAt, data: merged });
    await env.SCHEDULE.put(cacheKey, payload, { expirationTtl: SCHEDULE_RETENTION_SECONDS });
  }

  return { updated: true, fetchedAt };
}

export function selectActivity(data, activity) {
  return Object.fromEntries(Object.entries(data).map(([key, entry]) => {
    if (entry.activityFailures?.includes(activity)) {
      return [key, {
        ok: false,
        sessions: [],
        error: 'Schedule temporarily unavailable for this rink.',
      }];
    }
    const { activityFailures: _activityFailures, ...publicEntry } = entry;
    return [key, {
      ...publicEntry,
      sessions: (entry.sessions ?? []).filter(session => session.activity === activity),
    }];
  }));
}

function carryLastKnownGood(data, prev, nowMs, activity) {
  for (const key of Object.keys(data)) {
    if (data[key].ok !== false) continue;
    const prevEntry = prev?.data?.[key];
    if (!prevEntry?.ok) continue;
    const prevTs = prevEntry.fetchedAt ?? prev.fetchedAt;
    const prevTime = new Date(prevTs).getTime();
    if (!prevTs || !Number.isFinite(prevTime) || nowMs - prevTime > MAX_CARRY_MS) continue;
    data[key] = { ...prevEntry, stale: true, fetchedAt: prevTs };
    console.error(`runScrape: ${activity}:${key} failed, carrying forward data from ${prevTs}`);
  }
  return data;
}
