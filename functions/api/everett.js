// Compatibility endpoint for older cached clients. Reconstruct the legacy
// response from the scheduler snapshot instead of scraping Everett again.
import { handleScheduleRequest } from './schedule.js';

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const startDate = url.searchParams.get('startDate');
  const endDate = url.searchParams.get('endDate');
  if (!startDate || !endDate) return json(400, { error: 'Missing params' });

  const isHead = context.request.method === 'HEAD';
  const scheduleContext = isHead
    ? { ...context, request: new Request(context.request.url, { method: 'GET', headers: context.request.headers }) }
    : context;
  const schedule = await handleScheduleRequest(scheduleContext);
  if (!schedule.ok) return isHead ? head(schedule) : schedule;
  const data = await schedule.json();
  const rink = data.everett;
  if (!rink?.ok) {
    const failure = json(502, { error: 'Everett schedule temporarily unavailable.' });
    return isHead ? head(failure) : failure;
  }
  if (isHead) return head(schedule);

  const bySheet = new Map([
    ['Community Rink', []],
    ['Main Rink', []],
  ]);
  for (const session of rink.sessions ?? []) {
    const date = String(session.start ?? '').slice(0, 10);
    if (!bySheet.has(session.sheet) || date < startDate || date > endDate) continue;
    bySheet.get(session.sheet).push({
      id: String(session.id ?? '').replace(/^everett-/, ''),
      title: session.sourceLabel ?? session.title,
      startDate: date,
      startTime: String(session.start ?? '').slice(11),
      endTime: String(session.end ?? '').slice(11),
    });
  }

  return json(200, [...bySheet].map(([name, slots]) => ({ name, slots })), schedule.headers);
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
