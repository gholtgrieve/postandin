import { readPublicListingsWithPhotoRefs } from '../../../lib/gear-storage.mjs';
import {createGearPhotoSigner,gearPhotoDeliveryConfig} from '../../../lib/gear-photo-delivery.mjs';

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
export function createGearListingsHandler({read=readPublicListingsWithPhotoRefs,signer=createGearPhotoSigner,now=Date.now}={}){
 return async function gearListings(context) {
  const db=context.env?.GEAR_DB,config=gearPhotoDeliveryConfig(context.env);
  if (!db||!config) {
    console.error('Gear listings database or photo delivery is not configured.');
    return json(503, { error: 'Gear listings are temporarily unavailable.' });
  }

  try {
    const timestamp=now(),listings=await read(db,timestamp),sign=await signer(config,timestamp);
    const projected=await Promise.all(listings.map(async({photoRefs,...listing})=>({...listing,photos:await sign(photoRefs)})));
    return json(200, { listings: projected });
  } catch (error) {
    console.error('Gear listings request failed:', error);
    return json(500, { error: 'Unable to load Gear listings right now.' });
  }
 };
}

export const onRequestGet=createGearListingsHandler();
