// Public reads never scrape. Only the scheduler writes these snapshots.
import {
  SCHEDULE_CACHE_KEYS, SCHEDULE_CLOCK_SKEW_MS, SCHEDULE_FRESH_MS, SCHEDULE_MAX_AGE_MS,
} from '../../lib/scheduleCache.js';

export async function onRequest(context) {
  return handleScheduleRequest(context);
}

export async function handleScheduleRequest(context, { now = Date.now() } = {}) {
  if (!['GET', 'HEAD'].includes(context.request.method)) {
    return unavailable(405, 'Method not allowed.', { Allow: 'GET, HEAD' });
  }
  const activity = new URL(context.request.url).searchParams.get('activity') ?? 'stick-and-puck';
  if (!Object.hasOwn(SCHEDULE_CACHE_KEYS, activity)) {
    return unavailable(400, 'Unsupported activity.');
  }
  try {
    const cached = await context.env.GROUPS?.get(SCHEDULE_CACHE_KEYS[activity], { type: 'json' });
    const rawAge = now - Date.parse(cached?.fetchedAt);
    if (!cached?.data || !Number.isFinite(rawAge) || rawAge < -SCHEDULE_CLOCK_SKEW_MS || rawAge > SCHEDULE_MAX_AGE_MS) {
      return unavailable(503, 'Schedule temporarily unavailable.', { 'Retry-After': '300' });
    }
    const age = Math.max(0, rawAge);
    let stale = age > SCHEDULE_FRESH_MS;
    const data = Object.fromEntries(Object.entries(cached.data).map(([key, entry]) => {
      // A carried rink result has its own age; a healthy sibling must not
      // keep that older result alive indefinitely.
      const fetchedAt = entry.fetchedAt ?? cached.fetchedAt;
      const rawRinkAge = now - Date.parse(fetchedAt);
      if (entry.ok && (!Number.isFinite(rawRinkAge) || rawRinkAge < -SCHEDULE_CLOCK_SKEW_MS || rawRinkAge > SCHEDULE_MAX_AGE_MS)) {
        stale = true;
        return [key, { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' }];
      }
      const rinkAge = Math.max(0, rawRinkAge);
      if (entry.stale || (entry.ok && rinkAge > SCHEDULE_FRESH_MS)) {
        stale = true;
        return [key, { ...entry, stale: true, fetchedAt }];
      }
      return [key, entry];
    }));
    return new Response(context.request.method === 'HEAD' ? null : JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=120',
        'X-Cache': stale ? 'STALE' : 'HIT',
        'X-Fetched-At': cached.fetchedAt,
      },
    });
  } catch (error) {
    console.error('schedule cache read failed', activity, error?.message, error?.stack);
    return unavailable(503, 'Schedule temporarily unavailable.', { 'Retry-After': '300' });
  }
}

function unavailable(status, error, extra = {}) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store', ...extra },
  });
}
