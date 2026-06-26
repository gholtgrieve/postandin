// POST /api/groups/join  {groupName, password, displayName} → {groupId, groupName, memberId}
//
// Looks up the group by slug = groupName.trim().lower() + "|" + password.trim().lower()
// Also creates/updates a server-side session so membership survives localStorage loss.

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

  const slug = groupName.toLowerCase() + '|' + password.toLowerCase();
  const raw  = await GROUPS.get(`group:${slug}`);
  if (!raw) return json(404, { error: 'Group not found — check the group name and password' });

  const group    = JSON.parse(raw);
  const memberId = crypto.randomUUID();
  group.members.push({ id: memberId, displayName });
  await GROUPS.put(`group:${slug}`, JSON.stringify(group));

  // Persist membership server-side via session cookie
  const sessionId  = parseSid(context.request) || crypto.randomUUID();
  const rawSession = await GROUPS.get(`session:${sessionId}`);
  const session    = rawSession ? JSON.parse(rawSession) : { displayName, groups: [] };
  session.displayName = displayName;
  if (!session.groups.some(g => toSlug(g) === slug)) {
    session.groups.push({ groupName, password, memberId, displayName });
  }
  await GROUPS.put(`session:${sessionId}`, JSON.stringify(session));

  return jsonWithSession(200, { groupId: slug, groupName: group.groupName, memberId }, sessionId);
}

function toSlug(g) {
  return g.groupName.trim().toLowerCase() + '|' + g.password.trim().toLowerCase();
}

function parseSid(request) {
  const raw = request.headers.get('Cookie') || '';
  const match = raw.split(';').map(c => c.trim()).find(c => c.startsWith('sp_sid='));
  return match ? match.slice(7) : null;
}

function sidCookie(id) {
  return `sp_sid=${id}; Path=/; Max-Age=31536000; SameSite=Strict; Secure; HttpOnly`;
}

function jsonWithSession(status, body, sessionId) {
  return new Response(JSON.stringify(body), {
    status,
    headers: new Headers({
      'Content-Type': 'application/json',
      'Set-Cookie': sidCookie(sessionId),
    }),
  });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
