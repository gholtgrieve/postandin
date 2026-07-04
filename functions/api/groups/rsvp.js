// GET  /api/groups/rsvp?groupSlugs=slug1,slug2,...
//   → { [groupSlug]: { [sessionKey]: [displayName,...] } }
// POST /api/groups/rsvp  { sessionKey, groupSlug, memberId, displayName, going:bool }
//   → { going: [displayName,...] }
//
// RSVP data lives in a GroupDO Durable Object, one instance per group slug —
// see the comment in create.js for why (avoids the old direct-KV race). Each
// DO holds its own rsvp map: { [sessionKey]: [displayName,...] }, still keyed
// by displayName (not memberId), matching existing behavior exactly.
// Session key format: {rinkKey}|{YYYY-MM-DD}|{HH:MM}
//
// On every write, entries whose session start is >24h in the past are pruned
// so the map stays bounded — see pruneStale() in group-do/src/group-do.js.
//
// Requires a Durable Object binding named GROUP_DO, pointed at the GroupDO
// class in the postandin-group-do Worker (see group-do/). This can't be set via
// a config file for a Pages project — it must be added by hand:
//   Settings → Functions → Bindings → Add → Durable Object
//   Variable name: GROUP_DO  |  Worker: postandin-group-do  |  Class: GroupDO
// It won't happen automatically on deploy.

export async function onRequest(context) {
  const { method } = context.request;
  if (method === 'GET')  return handleGet(context);
  if (method === 'POST') return handlePost(context);
  return json(405, { error: 'Method not allowed' });
}

async function handleGet(context) {
  const { GROUP_DO } = context.env;
  if (!GROUP_DO) return json(503, { error: 'Durable Object GROUP_DO not bound' });

  const url   = new URL(context.request.url);
  const raw   = url.searchParams.get('groupSlugs') ?? '';
  const slugs = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (!slugs.length) return json(400, { error: 'groupSlugs is required' });

  const results = await Promise.all(
    slugs.map(async slug => {
      const stub = GROUP_DO.get(GROUP_DO.idFromName(slug));
      const val  = await stub.getRsvp(slug);
      return [slug, val ?? {}];
    })
  );

  return json(200, Object.fromEntries(results));
}

async function handlePost(context) {
  const { GROUP_DO } = context.env;
  if (!GROUP_DO) return json(503, { error: 'Durable Object GROUP_DO not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { sessionKey, groupSlug, memberId, displayName, going } = body ?? {};
  if (!sessionKey || !groupSlug || !memberId || !displayName)
    return json(400, { error: 'Missing required fields' });

  const stub   = GROUP_DO.get(GROUP_DO.idFromName(groupSlug));
  const result = await stub.setRsvp(groupSlug, sessionKey, memberId, displayName, going);

  if (result.error) return json(403, { error: result.error });

  return json(200, { going: result.going ?? [] });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
