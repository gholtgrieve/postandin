// Compatibility endpoint for older cached clients. Read the scheduler snapshot
// instead of starting another RecTimes scrape on every request.
import { handleScheduleRequest } from './schedule.js';

const RINK_BY_VENUE = Object.freeze({ 1145: 'olympicview', 1146: 'lynnwood' });

export async function onRequest(context) {
  const venueId = Number.parseInt(new URL(context.request.url).searchParams.get('venueId'), 10);
  const rinkKey = RINK_BY_VENUE[venueId];
  if (!rinkKey) return json(400, { error: 'Missing or unsupported venueId' });

  const schedule = await handleScheduleRequest(context);
  if (!schedule.ok) return schedule;
  if (context.request.method === 'HEAD') return head(schedule);
  const data = await schedule.json();
  const rink = data[rinkKey];
  return json(200, rink?.ok
    ? { ok: true, sessions: rink.sessions ?? [] }
    : { ok: false, error: rink?.error ?? 'RecTimes schedule temporarily unavailable.', sessions: [] },
  schedule.headers);
}

function head(source) {
  return new Response(null, { status: source.status, headers: source.headers });
}

function json(status, body, sourceHeaders) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': sourceHeaders?.get('Cache-Control') ?? 'no-store',
      ...(sourceHeaders?.get('X-Cache') ? { 'X-Cache': sourceHeaders.get('X-Cache') } : {}),
      ...(sourceHeaders?.get('X-Fetched-At') ? { 'X-Fetched-At': sourceHeaders.get('X-Fetched-At') } : {}),
    },
  });
}
