// POST /api/groups/leave  {groupName, password, memberId}
//
// Removes a member from the group's member list in KV.
// Deletes the group entirely if no members remain.
// Also removes the group from the caller's server-side session.

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

  const group   = JSON.parse(raw);
  group.members = group.members.filter(m => m.id !== memberId);

  if (group.members.length === 0) {
    await GROUPS.delete(`group:${slug}`);
  } else {
    await GROUPS.put(`group:${slug}`, JSON.stringify(group));
  }

  // Remove this group from the caller's session
  const sessionId = parseSid(context.request);
  if (sessionId) {
    const rawSession = await GROUPS.get(`session:${sessionId}`);
    if (rawSession) {
      const session = JSON.parse(rawSession);
      session.groups = session.groups.filter(g => toSlug(g) !== slug);
      await GROUPS.put(`session:${sessionId}`, JSON.stringify(session));
    }
  }

  return json(200, { ok: true });
}

function toSlug(g) {
  return g.groupName.trim().toLowerCase() + '|' + g.password.trim().toLowerCase();
}

function parseSid(request) {
  const raw = request.headers.get('Cookie') || '';
  const match = raw.split(';').map(c => c.trim()).find(c => c.startsWith('sp_sid='));
  return match ? match.slice(7) : null;
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
