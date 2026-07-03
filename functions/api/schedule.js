// GET /api/schedule
// Serves the pre-scraped schedule from KV (written by the scheduler Worker every 30 min).
// Falls back to a live scrape on first deploy before the scheduler has run.

import { scrapeAll } from '../../lib/scrapeAll.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=120',
};

export async function onRequest(context) {
  const { GROUPS } = context.env;

  if (GROUPS) {
    const cached = await GROUPS.get('schedule:cache', { type: 'json' });
    if (cached?.data) {
      return new Response(JSON.stringify(cached.data), {
        headers: { ...HEADERS, 'X-Cache': 'HIT', 'X-Fetched-At': cached.fetchedAt ?? '' },
      });
    }
  }

  // Cold-start fallback: live scrape (runs only until the first cron fires).
  const data = await scrapeAll();
  return new Response(JSON.stringify(data), {
    headers: { ...HEADERS, 'X-Cache': 'MISS' },
  });
}
