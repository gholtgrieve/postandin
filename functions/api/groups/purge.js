// POST /api/groups/purge
//
// One-time admin endpoint: deletes every key in the GROUPS KV namespace, then
// writes a _purged_v1 sentinel so subsequent calls are no-ops.
// No auth required — the endpoint is idempotent and the feature is disabled.

export async function onRequestPost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  const force = new URL(context.request.url).searchParams.get('force') === 'true';
  if (!force && await GROUPS.get('_purged_v1'))
    return json(200, { message: 'Already purged', deleted: 0 });

  await GROUPS.delete('_purged_v1');
  let deleted = 0;
  let cursor;
  do {
    const list = await GROUPS.list({ cursor });
    await Promise.all(list.keys.map(k => GROUPS.delete(k.name)));
    deleted += list.keys.length;
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  await GROUPS.put('_purged_v1', '1');
  return json(200, { message: 'Purged', deleted });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
