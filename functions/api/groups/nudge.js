// GET /api/groups/nudge?sessionKey=&rinkName=&date=&time=&displayName=
// Returns pre-filled share text. No data stored.
// Example: "Felix is going to Stick & Puck at KCI — Thu Jun 19 6:00 AM. You in? postandin.com/stick-and-puck/"

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sessionKey  = url.searchParams.get('sessionKey');
  const rinkName    = url.searchParams.get('rinkName');
  const date        = url.searchParams.get('date');   // YYYY-MM-DD
  const time        = url.searchParams.get('time');   // e.g. "6:00 AM"
  const displayName = url.searchParams.get('displayName');

  if (!sessionKey || !rinkName || !date || !time)
    return json(400, { error: 'Missing required params' });

  const d = new Date(`${date}T12:00:00`);
  const dayStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

  const who = displayName?.trim() ? `${displayName.trim()} is going` : "Someone's going";
  const text = `${who} to Stick & Puck at ${rinkName} — ${dayStr} ${time}. You in? postandin.com/stick-and-puck/`;

  return json(200, { text });
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
