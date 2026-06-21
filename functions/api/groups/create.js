// POST /api/groups/create  {groupName, password, displayName} → {groupId, groupName, memberId}
//
// KV key: group:<slug>  where slug = groupName.trim().lower() + "|" + password.trim().lower()
// The pair (groupName, password) identifies the group — neither needs to be globally unique alone.
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

  const groupName   = body?.groupName?.trim();
  const password    = body?.password?.trim();
  const displayName = body?.displayName?.trim();
  if (!groupName || !password || !displayName)
    return json(400, { error: 'groupName, password, and displayName are required' });
  if (groupName.length > 30)   return json(400, { error: 'Group name must be 30 characters or fewer' });
  if (password.length > 50)    return json(400, { error: 'Password must be 50 characters or fewer' });
  if (displayName.length > 30) return json(400, { error: 'Display name must be 30 characters or fewer' });

  const slug     = groupName.toLowerCase() + '|' + password.toLowerCase();
  const memberId = crypto.randomUUID();
  const group    = { groupName, members: [{ id: memberId, displayName }] };

  await GROUPS.put(`group:${slug}`, JSON.stringify(group));
  return json(200, { groupId: slug, groupName, memberId });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
