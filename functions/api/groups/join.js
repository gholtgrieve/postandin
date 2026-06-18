// POST /api/groups/join  {code, displayName} → {groupId, groupName, memberId}

export async function onRequestPost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const code = body?.code?.trim().toUpperCase();
  const displayName = body?.displayName?.trim();
  if (!code || !displayName)
    return json(400, { error: 'code and displayName are required' });

  const raw = await GROUPS.get(`group:${code}`);
  if (!raw) return json(404, { error: 'Group not found' });

  const group = JSON.parse(raw);
  const memberId = crypto.randomUUID();
  group.members.push({ id: memberId, displayName });
  await GROUPS.put(`group:${code}`, JSON.stringify(group));

  return json(200, { groupId: code, groupName: group.name, memberId });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
