// GET  /api/groups/rsvp?groupSlugs=slug1,slug2,...
//   → { [groupSlug]: { [sessionKey]: [displayName,...] } }
// POST /api/groups/rsvp  { sessionKey, groupSlug, memberId, displayName, going:bool }
//   → { going: [displayName,...] }
//
// KV key: rsvp:{groupSlug}  →  JSON map of { [sessionKey]: [displayName,...] }
// One key per group (not per session), so reads scale with group count, not session count.
// Session key format: {rinkKey}|{YYYY-MM-DD}|{HH:MM}
//
// On every write, entries whose session start is >24h in the past are pruned
// so the map stays bounded without requiring explicit TTL management.

export async function onRequest(context) {
  const { method } = context.request;
  if (method === 'GET')  return handleGet(context);
  if (method === 'POST') return handlePost(context);
  return json(405, { error: 'Method not allowed' });
}

async function handleGet(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  const url   = new URL(context.request.url);
  const raw   = url.searchParams.get('groupSlugs') ?? '';
  const slugs = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!slugs.length) return json(400, { error: 'groupSlugs is required' });

  const results = await Promise.all(
    slugs.map(async slug => {
      const val = await GROUPS.get(`rsvp:${slug}`, { type: 'json' });
      return [slug, val ?? {}];
    })
  );

  return json(200, Object.fromEntries(results));
}

async function handlePost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { sessionKey, groupSlug, memberId, displayName, going } = body ?? {};
  if (!sessionKey || !groupSlug || !memberId || !displayName)
    return json(400, { error: 'Missing required fields' });

  const kvKey = `rsvp:${groupSlug}`;
  const map   = (await GROUPS.get(kvKey, { type: 'json' })) ?? {};

  if (!map[sessionKey]) map[sessionKey] = [];
  if (going) {
    if (!map[sessionKey].includes(displayName)) map[sessionKey].push(displayName);
  } else {
    map[sessionKey] = map[sessionKey].filter(n => n !== displayName);
  }

  pruneStale(map);

  // 30-day TTL keeps abandoned groups from persisting indefinitely.
  // Content is bounded by pruneStale on every write.
  await GROUPS.put(kvKey, JSON.stringify(map), { expirationTtl: 30 * 24 * 60 * 60 });

  return json(200, { going: map[sessionKey] ?? [] });
}

function pruneStale(map) {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const sk of Object.keys(map)) {
    const parts = sk.split('|');
    if (parts.length < 3) continue;
    const sessionStart = new Date(`${parts[1]}T${parts[2]}:00`);
    if (!isNaN(sessionStart) && sessionStart.getTime() < cutoff) {
      delete map[sk];
    }
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
