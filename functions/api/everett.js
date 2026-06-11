// functions/api/everett.js
// Cloudflare Pages Function — proxies the Angel of the Winds arena schedule API.
// On fetch failure, serves the last good response from the Workers Cache API.

const CACHE_KEY = new Request('https://cache.internal/postandin/everett-v1');
const RESPONSE_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate   = url.searchParams.get('endDate');
  if (!startDate || !endDate)
    return new Response(JSON.stringify({ error: 'Missing params' }), { status: 400 });

  const upstream = `https://us-central1-aotw-arena.cloudfunctions.net/api/calendar/417/443?startDate=${startDate}&endDate=${endDate}`;
  const cache = caches.default;

  try {
    const res = await fetch(upstream, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);

    const body = await res.text();

    // Cache the fresh payload; client always filters by date so stale data is still useful.
    ctx.waitUntil(cache.put(CACHE_KEY, new Response(body, {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=86400' },
    })));

    return new Response(body, { headers: RESPONSE_HEADERS });
  } catch (e) {
    const cached = await cache.match(CACHE_KEY);
    if (cached) return new Response(await cached.text(), { headers: RESPONSE_HEADERS });
    return new Response(JSON.stringify({ error: e.message }), { status: 502 });
  }
}
