// POST /api/groups/create  {name, displayName} → {code, groupId, memberId}
//
// Requires KV namespace binding named GROUPS.
// Cloudflare Pages does not use wrangler.toml for KV bindings — configure it
// in the Cloudflare Pages dashboard under:
//   Settings → Functions → KV namespace bindings → Add binding
//   Variable name: GROUPS  |  KV namespace: <your namespace>

export async function onRequestPost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const name = body?.name?.trim();
  const displayName = body?.displayName?.trim();
  if (!name || !displayName)
    return json(400, { error: 'name and displayName are required' });

  const code = randomCode();
  const memberId = crypto.randomUUID();
  const group = { name, members: [{ id: memberId, displayName }] };

  await GROUPS.put(`group:${code}`, JSON.stringify(group));
  return json(200, { code, groupId: code, memberId });
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map(b => chars[b % chars.length]).join('');
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
