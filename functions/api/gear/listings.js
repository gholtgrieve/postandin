import { readPublicListings } from '../../../lib/gear-storage.mjs';

const HEADERS = {
  'Content-Type': 'application/json; charset=UTF-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

// Source-only production integration seam. The Gear UI is not connected and
// no remote binding or database has been provisioned.
export async function onRequestGet(context) {
  const db = context.env?.GEAR_DB;
  if (!db) {
    console.error('Gear listings database is not configured.');
    return json(503, { error: 'Gear listings are temporarily unavailable.' });
  }

  try {
    const listings = await readPublicListings(db);
    return json(200, { listings: listings.map(listing => ({ ...listing, photos: [] })) });
  } catch (error) {
    console.error('Gear listings request failed:', error);
    return json(500, { error: 'Unable to load Gear listings right now.' });
  }
}
