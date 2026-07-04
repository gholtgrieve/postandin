// functions/api/kentvalley.js
// Thin wrapper around the shared scraper. The Workers Cache API fallback
// protects against upstream failures on visitor-facing requests.

import { scrapeKentValley } from '../../lib/scrapers/kentvalley.js';

const CACHE_KEY = new Request('https://cache.internal/postandin/kentvalley-v1');
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(ctx) {
  const cache = caches.default;

  try {
    const { sessions, rawEventCount } = await scrapeKentValley();
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
    console.error(e.message, e.stack);
    return new Response(
      JSON.stringify({ ok: false, error: 'Kent Valley schedule temporarily unavailable.', sessions: [] }),
      { status: 200, headers: RESPONSE_HEADERS },
    );
  }
}
