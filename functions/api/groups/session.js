// GET  /api/groups/session           → { displayName, groups: [...] }
// POST /api/groups/session  {displayName, groups} → { ok: true }
//
// Reads/writes the caller's session from the sp_sid cookie.
// On POST, creates a new session if no cookie is present.
// KV key: session:{sessionId}
//
// The self-heal loop in handlePost writes membership through to each group's
// GroupDO Durable Object instead of touching group:<slug> in KV directly —
// see the comment in create.js for why (avoids the old direct-KV race).
//
// Requires a Durable Object binding named GROUP_DO, pointed at the GroupDO
// class in the postandin-group-do Worker (see group-do/). This can't be set via
// a config file for a Pages project — it must be added by hand:
//   Settings → Functions → Bindings → Add → Durable Object
//   Variable name: GROUP_DO  |  Worker: postandin-group-do  |  Class: GroupDO
// It won't happen automatically on deploy.

export async function onRequest(context) {
  const { method } = context.request;
  if (method === 'GET')  return handleGet(context);
  if (method === 'POST') return handlePost(context);
  return json(405, { error: 'Method not allowed' });
}

async function handleGet(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV not bound' });

  const sessionId = parseSid(context.request);
  if (!sessionId) return json(200, { displayName: '', groups: [] });

  const raw = await GROUPS.get(`session:${sessionId}`);
  if (!raw)  return json(200, { displayName: '', groups: [] });

  let displayName = '', groups = [];
  try {
    ({ displayName = '', groups = [] } = JSON.parse(raw));
  } catch (e) {
    console.error(`session.js: corrupted session record for ${sessionId}:`, e.message);
  }
  return json(200, { displayName, groups });
}

async function handlePost(context) {
  const { GROUPS, GROUP_DO } = context.env;
  if (!GROUPS) return json(503, { error: 'KV not bound' });
  if (!GROUP_DO) return json(503, { error: 'Durable Object GROUP_DO not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { displayName, groups } = body ?? {};
  const validGroups = Array.isArray(groups) ? groups : [];

  let sessionId = parseSid(context.request) || crypto.randomUUID();

  // Write session record.
  await GROUPS.put(`session:${sessionId}`, JSON.stringify({
    displayName: displayName || '',
    groups: validGroups,
  }));

  // Upsert membership for each group in the payload so group records self-heal
  // when members visit after a data loss event. Each member who visits
  // contributes their own entry back; the group fully reconstructs once all
  // members have visited at least once.
  await Promise.all(validGroups.map(async g => {
    const gName = g.groupName?.trim();
    const gPass = g.password?.trim();
    const memberId = g.memberId;
    const mName = g.displayName || displayName || '';
    if (!gName || !gPass || !memberId) return;

    const slug = gName.toLowerCase() + '|' + gPass.toLowerCase();
    const stub = GROUP_DO.get(GROUP_DO.idFromName(slug));
    await stub.upsertMember(slug, memberId, mName);
  }));

  return jsonWithSession(200, { ok: true }, sessionId);
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
