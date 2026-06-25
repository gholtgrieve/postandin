// POST /api/groups/leave  {groupName, password, memberId}
//
// Removes a member from the group's member list in KV.
// Deletes the group entirely if no members remain.

export async function onRequestPost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const groupName = body?.groupName?.trim();
  const password  = body?.password?.trim();
  const memberId  = body?.memberId;

  if (!groupName || !password || !memberId)
    return json(400, { error: 'groupName, password, and memberId are required' });

  const slug = groupName.toLowerCase() + '|' + password.toLowerCase();
  const raw  = await GROUPS.get(`group:${slug}`);
  if (!raw) return json(404, { error: 'Group not found' });

  const group    = JSON.parse(raw);
  group.members  = group.members.filter(m => m.id !== memberId);

  if (group.members.length === 0) {
    await GROUPS.delete(`group:${slug}`);
  } else {
    await GROUPS.put(`group:${slug}`, JSON.stringify(group));
  }

  return json(200, { ok: true });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
