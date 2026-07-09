// Scheduler Worker — runs two independent cron jobs:
//
//  1. Schedule cache (every 30 min): scrapes all rinks, writes the result to
//     KV as schedule:cache. The Pages Function at /api/schedule reads from
//     this cache instead of scraping on every visitor request.
//  2. GROUPS backup (daily, ~3am Pacific): full export of the GROUPS KV
//     namespace to R2. See src/backup.js.
//
// Manual triggers for testing (do not run in production on their own):
//   curl https://<worker-subdomain>.workers.dev/trigger      (schedule cache)
//   curl https://<worker-subdomain>.workers.dev/backup-now   (GROUPS backup)

import { scrapeAll } from '../../lib/scrapeAll.js';
import { backupGroups } from './backup.js';

const BACKUP_CRON = '0 10 * * *';

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
  const data = await scrapeAll(opts);
  const anyOk = Object.values(data).some(r => r.ok);
  if (!anyOk) {
    console.error('runScrape: every rink failed this run — keeping existing schedule:cache instead of overwriting with an all-failed payload');
    return;
  }

  // Per-rink last-known-good merge: if a rink failed this run but succeeded in
  // the previous cache, carry its data forward (up to 24h old) so an
  // intermittent upstream outage doesn't surface an error to every visitor.
  const prev = await env.SCHEDULE.get('schedule:cache', { type: 'json' });
  const MAX_CARRY_MS = 24 * 60 * 60 * 1000;
  for (const key of Object.keys(data)) {
    if (data[key].ok !== false) continue;
    const prevEntry = prev?.data?.[key];
    if (!prevEntry?.ok) continue;
    const prevTs = prevEntry.fetchedAt ?? prev.fetchedAt;
    if (!prevTs || Date.now() - new Date(prevTs).getTime() > MAX_CARRY_MS) continue;
    data[key] = { ...prevEntry, stale: true, fetchedAt: prevTs };
    console.error(`runScrape: ${key} failed, carrying forward data from ${prevTs}`);
  }

  const payload = JSON.stringify({ fetchedAt: new Date().toISOString(), data });
  // 2-hour TTL: if the scheduler stops running, the Pages Function falls back
  // to live scraping rather than serving indefinitely-stale data.
  await env.SCHEDULE.put('schedule:cache', payload, { expirationTtl: 7200 });
}

function json(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
}
