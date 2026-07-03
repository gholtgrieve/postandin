// Proactive schedule cache Worker.
// Fires every 30 minutes via Cron Trigger, scrapes all rinks, writes the
// result to KV as schedule:cache.  The Pages Function at /api/schedule reads
// from this cache instead of scraping on every visitor request.
//
// Manual trigger for testing (does not run in production on its own):
//   curl https://<worker-subdomain>.workers.dev/trigger

import { scrapeAll } from '../../lib/scrapeAll.js';

export default {
  async scheduled(_event, env, ctx) {
    // Real cron firing: jitter the RecTimes calls so they don't look like a
    // fixed bot schedule to RecTimes' bot detection.
    ctx.waitUntil(runScrape(env, { jitterRecTimes: true }));
  },

  async fetch(req, env, _ctx) {
    if (new URL(req.url).pathname !== '/trigger') {
      return new Response('Not found', { status: 404 });
    }
    // Manual trigger: run immediately, no jitter, so testing isn't slow.
    await runScrape(env);
    return new Response(JSON.stringify({ ok: true, updatedAt: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

async function runScrape(env, opts = {}) {
  const data = await scrapeAll(opts);
  const payload = JSON.stringify({ fetchedAt: new Date().toISOString(), data });
  // 2-hour TTL: if the scheduler stops running, the Pages Function falls back
  // to live scraping rather than serving indefinitely-stale data.
  await env.SCHEDULE.put('schedule:cache', payload, { expirationTtl: 7200 });
}
