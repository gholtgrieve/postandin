// GET  /api/groups/rsvp?sessionKey=&groupSlug=  → {going:[displayName,...]}
// POST /api/groups/rsvp  {sessionKey, groupSlug, memberId, displayName, going:bool}
//
// Session key format: {rinkKey}|{YYYY-MM-DD}|{HH:MM}
// groupSlug: groupName.trim().lower() + "|" + password.trim().lower()
// KV key: rsvp:{groupSlug}:{sessionKey}
// RSVP entries expire 24 hours after the session start time.

export async function onRequest(context) {
  const { method } = context.request;
  if (method === 'GET')  return handleGet(context);
  if (method === 'POST') return handlePost(context);
  return json(405, { error: 'Method not allowed' });
}

async function handleGet(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  const url        = new URL(context.request.url);
  const sessionKey = url.searchParams.get('sessionKey');
  const groupSlug  = url.searchParams.get('groupSlug');
  if (!sessionKey || !groupSlug)
    return json(400, { error: 'sessionKey and groupSlug are required' });

  const raw = await GROUPS.get(`rsvp:${groupSlug}:${sessionKey}`);
  return json(200, { going: raw ? JSON.parse(raw) : [] });
}

async function handlePost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { sessionKey, groupSlug, memberId, displayName, going } = body ?? {};
  if (!sessionKey || !groupSlug || !memberId || !displayName)
    return json(400, { error: 'Missing required fields' });

  const kvKey = `rsvp:${groupSlug}:${sessionKey}`;
  const raw   = await GROUPS.get(kvKey);
  let roster  = raw ? JSON.parse(raw) : [];

  if (going) {
    if (!roster.includes(displayName)) roster.push(displayName);
  } else {
    roster = roster.filter(n => n !== displayName);
  }

  // Expire 24 hours after session start; fall back to 24 hours from now if unparseable.
  const parts        = sessionKey.split('|');
  const sessionStart = parts.length >= 3 ? new Date(`${parts[1]}T${parts[2]}:00`) : null;
  const sessionUnix  = sessionStart && !isNaN(sessionStart) ? Math.floor(sessionStart.getTime() / 1000) : null;
  const nowUnix      = Math.floor(Date.now() / 1000);
  const expirationTtl = sessionUnix
    ? Math.max(60, sessionUnix + 86400 - nowUnix)
    : 86400;

  await GROUPS.put(kvKey, JSON.stringify(roster), { expirationTtl });
  return json(200, { going: roster });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
