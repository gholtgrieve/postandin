// POST /api/groups/join  {groupName, password, displayName} → {groupId, groupName, memberId}
//
// Looks up the group by slug = groupName.trim().lower() + "|" + password.trim().lower()

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

  const slug = groupName.toLowerCase() + '|' + password.toLowerCase();
  const raw  = await GROUPS.get(`group:${slug}`);
  if (!raw) return json(404, { error: 'Group not found — check the group name and password' });

  const group    = JSON.parse(raw);
  const memberId = crypto.randomUUID();
  group.members.push({ id: memberId, displayName });
  await GROUPS.put(`group:${slug}`, JSON.stringify(group));

  return json(200, { groupId: slug, groupName: group.groupName, memberId });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
