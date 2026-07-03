// POST /api/groups/create  {groupName, password, displayName} → {groupId, groupName, memberId}
//
// Group membership lives in a GroupDO Durable Object, one instance per
// slug = groupName.trim().lower() + "|" + password.trim().lower(). Cloudflare
// serializes all calls to a given DO instance, so concurrent create/join/leave
// calls against the same group can't race and silently clobber each other the
// way the old direct GROUPS.get/GROUPS.put read-modify-write against a shared
// group:<slug> KV key could. See group-do/src/group-do.js for the DO itself.
//
// Also creates/updates a server-side session (KV key: session:<sessionId>) so the user's
// group membership survives localStorage loss (Private Browsing, cleared site data, etc.).
// Session storage is unrelated to group membership and still lives directly in KV.
//
// Requires KV namespace binding named GROUPS (used here only for session:<sessionId>).
// Cloudflare Pages does not use wrangler.toml for KV bindings — configure it
// in the Cloudflare Pages dashboard under:
//   Settings → Functions → KV namespace bindings → Add binding
//   Variable name: GROUPS  |  KV namespace: <your namespace>
//
// Also requires a Durable Object binding named GROUP_DO, pointed at the GroupDO
// class in the postandin-group-do Worker (see group-do/). This can't be set via
// a config file for a Pages project — it must be added by hand:
//   Settings → Functions → Bindings → Add → Durable Object
//   Variable name: GROUP_DO  |  Worker: postandin-group-do  |  Class: GroupDO
// It won't happen automatically on deploy.

export async function onRequestPost(context) {
  const { GROUPS, GROUP_DO } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });
  if (!GROUP_DO) return json(503, { error: 'Durable Object GROUP_DO not bound' });

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

  const slug   = groupName.toLowerCase() + '|' + password.toLowerCase();
  const stub   = GROUP_DO.get(GROUP_DO.idFromName(slug));
  const result = await stub.create(slug, groupName, displayName);

  if (!result.created) {
    return json(409, { error: result.error });
  }
  const { memberId } = result;

  // Persist membership server-side via session cookie
  const sessionId  = parseSid(context.request) || crypto.randomUUID();
  const rawSession = await GROUPS.get(`session:${sessionId}`);
  const session    = rawSession ? JSON.parse(rawSession) : { displayName, groups: [] };
  session.displayName = displayName;
  if (!session.groups.some(g => toSlug(g) === slug)) {
    session.groups.push({ groupName, password, memberId, displayName });
  }
  await GROUPS.put(`session:${sessionId}`, JSON.stringify(session));

  return jsonWithSession(200, { groupId: slug, groupName, memberId }, sessionId);
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
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', sidCookie(sessionId));
  headers.append('Set-Cookie', 'sp_has_session=1; Path=/; Max-Age=31536000; SameSite=Strict; Secure');
  return new Response(JSON.stringify(body), { status, headers });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
