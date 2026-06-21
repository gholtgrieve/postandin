export async function onRequest(context) {
  const url = new URL(context.request.url);
  const venueId = parseInt(url.searchParams.get('venueId'), 10);
  if (!venueId) {
    return new Response(JSON.stringify({ error: 'Missing venueId' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const future = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const futureDate = future.toISOString().slice(0, 10);

  // Local-time strings (no Z) from RecTimes are Pacific.
  // On Cloudflare Workers (UTC), comparing them directly against Date.now() would
  // be 7-8 h off. Use the same toPacificLocal technique as kentvalley.js.
  const pacificNow = toPacificLocal(now.toISOString());

  const HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=300',
  };

  try {
    const res = await fetch(
      'https://api.rectimes.com/api/v1/facilities/ova/bookings/get_for_calendar',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Referer': 'https://app.rectimes.com/',
        },
        body: JSON.stringify({
          venueIds: [venueId],
          startTimeLocal: `${today}T00:00:00Z`,
          endTimeLocal: `${futureDate}T00:00:00Z`,
        }),
      },
    );
    if (!res.ok) throw new Error(`RecTimes HTTP ${res.status}`);

    const data = await res.json();
    const bookings = Array.isArray(data) ? data : (data?.bookings ?? []);

    const sessions = bookings
      .filter(b => /stick\s*(?:&|and)\s*puck/i.test(b.groupName ?? ''))
      .filter(b => (b.endTimeLocal ?? b.startTimeLocal) > pacificNow)
      .map(b => ({
        id: String(b.id ?? b.bookingId ?? b.startTimeLocal),
        start: b.startTimeLocal,
        end: b.endTimeLocal ?? null,
        title: b.groupName,
        subtitle: null,
        spots: null,
        price: null,
        soldOut: false,
        bookUrl: 'https://app.rectimes.com/ova',
      }));

    return new Response(JSON.stringify({ ok: true, sessions }), { headers: HEADERS });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message, sessions: [] }),
      { status: 200, headers: HEADERS },
    );
  }
}

function toPacificLocal(isoStr) {
  const d = new Date(isoStr);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const p = Object.fromEntries(parts.filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
