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
// Manual triggers for testing (do not run in production on their own):
//   curl https://<worker-subdomain>.workers.dev/trigger      (schedule cache)
//   curl https://<worker-subdomain>.workers.dev/backup-now   (GROUPS backup)

import { scrapeAll } from '../../lib/scrapeAll.js';
import {
  ACTIVITY_DROP_IN_HOCKEY,
  ACTIVITY_PUBLIC_SKATE,
  ACTIVITY_STICK_AND_PUCK,
  SUPPORTED_ACTIVITIES,
} from '../../lib/activities.js';
import { backupGroups } from './backup.js';

const BACKUP_CRON = '0 10 * * *';
const CACHE_TTL_SECONDS = 2 * 60 * 60;
const MAX_CARRY_MS = 24 * 60 * 60 * 1000;

export const SCHEDULE_CACHE_KEYS = Object.freeze({
  [ACTIVITY_STICK_AND_PUCK]: 'schedule:cache',
  [ACTIVITY_DROP_IN_HOCKEY]: 'schedule:cache:drop-in-hockey',
  [ACTIVITY_PUBLIC_SKATE]: 'schedule:cache:public-skate',
});

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

  async fetch(req, env, _ctx) {
    const path = new URL(req.url).pathname;

    if (path === '/trigger') {
      // Manual trigger: run immediately, no jitter, so testing isn't slow.
      await runScrape(env);
      return json({ ok: true, updatedAt: new Date().toISOString() });
    }

    if (path === '/backup-now') {
      const result = await backupGroups(env);
      return json({ ok: true, ...result });
    }

    return new Response('Not found', { status: 404 });
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
    await env.SCHEDULE.put(cacheKey, payload, { expirationTtl: CACHE_TTL_SECONDS });
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

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
