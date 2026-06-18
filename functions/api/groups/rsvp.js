// GET  /api/groups/rsvp?sessionKey=&groupCode=  → {going:[displayName,...]}
// POST /api/groups/rsvp  {sessionKey, groupCode, memberId, displayName, going:bool}
//
// Session key format: {rinkKey}|{YYYY-MM-DD}|{HH:MM}
// KV key: rsvp:{groupCode}:{sessionKey}

export async function onRequest(context) {
  const { method } = context.request;
  if (method === 'GET')  return handleGet(context);
  if (method === 'POST') return handlePost(context);
  return json(405, { error: 'Method not allowed' });
}

async function handleGet(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  const url = new URL(context.request.url);
  const sessionKey = url.searchParams.get('sessionKey');
  const groupCode  = url.searchParams.get('groupCode');
  if (!sessionKey || !groupCode)
    return json(400, { error: 'sessionKey and groupCode are required' });

  const raw = await GROUPS.get(`rsvp:${groupCode}:${sessionKey}`);
  return json(200, { going: raw ? JSON.parse(raw) : [] });
}

async function handlePost(context) {
  const { GROUPS } = context.env;
  if (!GROUPS) return json(503, { error: 'KV namespace GROUPS not bound' });

  let body;
  try { body = await context.request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { sessionKey, groupCode, memberId, displayName, going } = body ?? {};
  if (!sessionKey || !groupCode || !memberId || !displayName)
    return json(400, { error: 'Missing required fields' });

  const kvKey = `rsvp:${groupCode}:${sessionKey}`;
  const raw = await GROUPS.get(kvKey);
  let roster = raw ? JSON.parse(raw) : [];

  if (going) {
    if (!roster.includes(displayName)) roster.push(displayName);
  } else {
    roster = roster.filter(n => n !== displayName);
  }

  // Keep RSVP records for 30 days
  await GROUPS.put(kvKey, JSON.stringify(roster), { expirationTtl: 60 * 60 * 24 * 30 });
  return json(200, { going: roster });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
