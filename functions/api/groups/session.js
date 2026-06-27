// GET  /api/groups/session           → { displayName, groups: [...] }
// POST /api/groups/session  {displayName, groups} → { ok: true }
//
// Reads/writes the caller's session from the sp_sid cookie.
// On POST, creates a new session if no cookie is present.
// KV key: session:{sessionId}

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

  const { displayName = '', groups = [] } = JSON.parse(raw);
  return json(200, { displayName, groups });
}

async function handlePost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { displayName, groups } = body ?? {};

  let sessionId = parseSid(context.request) || crypto.randomUUID();

  await GROUPS.put(`session:${sessionId}`, JSON.stringify({
    displayName: displayName || '',
    groups: Array.isArray(groups) ? groups : [],
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
