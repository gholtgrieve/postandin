// POST /api/groups/leave  {groupName, password, memberId}
//
// Removes a member from the group's member list, which lives in a GroupDO
// Durable Object, one instance per slug — see the comment in create.js for
// why (avoids the old direct-KV race). An empty member list afterward is
// fine and equivalent to the old "delete the group" behavior — a later
// create or join against the same slug behaves as if the group were gone.
// Also removes the group from the caller's server-side session.
//
// Requires a Durable Object binding named GROUP_DO, pointed at the GroupDO
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

  const groupName = body?.groupName?.trim();
  const password  = body?.password?.trim();
  const memberId  = body?.memberId;

  if (!groupName || !password || !memberId)
    return json(400, { error: 'groupName, password, and memberId are required' });

  const slug = groupName.toLowerCase() + '|' + password.toLowerCase();
  const stub = GROUP_DO.get(GROUP_DO.idFromName(slug));
  await stub.leave(slug, memberId);

  // Remove this group from the caller's session
  const sessionId = parseSid(context.request);
  if (sessionId) {
    const rawSession = await GROUPS.get(`session:${sessionId}`);
    if (rawSession) {
      try {
        const session = JSON.parse(rawSession);
        session.groups = session.groups.filter(g => toSlug(g) !== slug);
        await GROUPS.put(`session:${sessionId}`, JSON.stringify(session));
      } catch (e) {
        console.error(`${sessionId}: corrupted session record, skipping leave-session-update:`, e.message);
      }
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
