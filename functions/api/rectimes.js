// functions/api/rectimes.js
// Thin wrapper around the shared scraper.

import { scrapeRecTimes } from '../../lib/scrapers/rectimes.js';

const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=300',
};

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const venueId = parseInt(url.searchParams.get('venueId'), 10);
  if (!venueId) {
    return new Response(JSON.stringify({ error: 'Missing venueId' }), { status: 400, headers: HEADERS });
  }

  try {
    const sessions = await scrapeRecTimes({ venueId });
    return new Response(JSON.stringify({ ok: true, sessions }), { headers: HEADERS });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e.message, sessions: [] }),
      { status: 200, headers: HEADERS },
    );
  }
}
