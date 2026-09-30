import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { createDraft } from '../lib/gear-storage.mjs';
import {recordHostedPhoto} from '../lib/gear-photo-storage.mjs';
import {gearPhotoDeliveryConfig} from '../lib/gear-photo-delivery.mjs';
import {createGearListingsHandler,onRequestGet} from '../functions/api/gear/listings.js';

const sample = {
  title: 'Club bag',
  description: 'Worn zipper, repaired seam.',
  city: 'Seattle',
  fit: 'Junior bag',
  sellerName: 'Sample seller',
  email: 'sample@example.test',
  adult: true,
  category: 'Bags & accessories',
  size: 'One size',
  condition: 'Used — good',
  type: 'sale',
  priceCents: 4050,
  clubs: ['Kent Valley'],
};
let createdSequence = 0;
const delivery={GEAR_IMAGES_ACCOUNT_HASH:'AbCdEfGhIjKlMnOpQrStUv',GEAR_IMAGES_PUBLIC_VARIANT:'gear-public',GEAR_IMAGES_SIGNING_KEY:'test-signing-key-not-secret'};

async function addListing(db, title, email, { status = 'available', listingVerified = true, sellerVerified = true, expiresAt } = {}) {
  const now = Date.now();
  const { id } = await createDraft(db, { ...sample, title, email }, now - 10000 + createdSequence++);
  if (sellerVerified) db.sqlite.prepare('UPDATE gear_sellers SET verified_at=? WHERE email=?').run(now - 500, email);
  if (listingVerified || status !== 'unverified') {
    db.sqlite.prepare('UPDATE gear_listings SET status=?,verified_at=?,expires_at=? WHERE id=?')
      .run(status, listingVerified ? now - 500 : null, expiresAt ?? now + 60000, id);
  }
  return id;
}

test('Pages Gear listing route returns only currently public fields', async () => {
  const db = openLocalDatabase();
  try {
    const visibleId = await addListing(db, 'Visible bag', 'visible@example.test');
    await addListing(db, 'Pending skates', 'pending@example.test', { status: 'pending' });
    await addListing(db, 'Expired helmet', 'expired@example.test', { status: 'available', expiresAt: Date.now() - 1 });
    await addListing(db, 'Removed pads', 'removed@example.test', { status: 'removed' });
    await addListing(db, 'Closed stick', 'closed@example.test', { status: 'closed' });
    await addListing(db, 'Unverified listing', 'listing@example.test', { status: 'unverified', listingVerified: false });
    await addListing(db, 'Unverified seller', 'seller@example.test', { sellerVerified: false });

    const response = await onRequestGet({ env: { GEAR_DB: db,...delivery } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=UTF-8');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');

    const { listings } = await response.json();
    assert.deepEqual(listings.map(row => row.title), ['Pending skates', 'Visible bag']);
    const visible = listings.find(row => row.id === visibleId);
    assert.deepEqual(visible.photos, []);
    assert.deepEqual(visible.clubs, ['Kent Valley']);
    assert.deepEqual(Object.keys(visible).sort(), [
      'category', 'city', 'clubs', 'condition', 'description', 'fit', 'id',
      'otherClub', 'photos', 'priceCents', 'sellerName', 'size', 'status',
      'title', 'trade', 'type',
    ]);
  } finally {
    db.close();
  }
});

test('Pages Gear listing route caps results at 100 with deterministic tie ordering', async () => {
  const db = openLocalDatabase();
  try {
    const createdBase = 1700000000000;
    const rows = [];
    for (let index = 0; index <= 100; index += 1) {
      const id = await addListing(db, `Visible listing ${index}`, `visible-${index}@example.test`);
      const createdAt = createdBase + (index === 99 ? 100 : index);
      db.sqlite.prepare('UPDATE gear_listings SET created_at=? WHERE id=?').run(createdAt, id);
      rows.push({ id, createdAt });
    }

    const response = await onRequestGet({ env: { GEAR_DB: db,...delivery } });
    assert.equal(response.status, 200);
    const { listings } = await response.json();

    const oldestId = rows[0].id;
    const expectedIds = [...rows]
      .sort((left, right) => right.createdAt - left.createdAt || (left.id < right.id ? -1 : 1))
      .slice(0, 100)
      .map(row => row.id);
    assert.equal(listings.length, 100);
    assert.deepEqual(listings.map(row => row.id), expectedIds);
    assert.equal(listings.some(row => row.id === oldestId), false);
  } finally {
    db.close();
  }
});

test('Pages Gear listing route signs only ordered photos on currently public listings',async()=>{
  const db=openLocalDatabase();try{
    const now=1700000000123,visibleId=await addListing(db,'Visible photos','photos@example.test'),hiddenId=await addListing(db,'Hidden photos','hidden-photos@example.test',{status:'removed'});
    const first=await recordHostedPhoto(db,visibleId,'00000000-0000-4000-8000-000000000001',now-2);
    const second=await recordHostedPhoto(db,visibleId,'00000000-0000-4000-8000-000000000002',now-1);
    const third=await recordHostedPhoto(db,visibleId,'00000000-0000-4000-8000-000000000004',now);
    db.sqlite.prepare('UPDATE gear_photos SET position=5 WHERE id=?').run(first.id);
    db.sqlite.prepare('UPDATE gear_photos SET position=0 WHERE id=?').run(third.id);
    db.sqlite.prepare('UPDATE gear_photos SET position=2 WHERE id=?').run(first.id);
    await recordHostedPhoto(db,hiddenId,'00000000-0000-4000-8000-000000000003',now);
    const response=await createGearListingsHandler({now:()=>now})({env:{GEAR_DB:db,...delivery}});
    assert.equal(response.status,200);const body=await response.json(),listing=body.listings.find(row=>row.id===visibleId);
    assert.deepEqual(listing.photos.map(photo=>({id:photo.id,name:photo.name})),[{id:third.id,name:'Photo 1'},{id:second.id,name:'Photo 2'},{id:first.id,name:'Photo 3'}]);
    const expiry=Math.floor(now/1000)+600,path=`/${delivery.GEAR_IMAGES_ACCOUNT_HASH}/${third.providerId}/${delivery.GEAR_IMAGES_PUBLIC_VARIANT}`;
    const signature=createHmac('sha256',delivery.GEAR_IMAGES_SIGNING_KEY).update(`${path}?exp=${expiry}`).digest('hex');
    assert.equal(listing.photos[0].url,`https://imagedelivery.net${path}?exp=${expiry}&sig=${signature}`);
    assert.equal(JSON.stringify(body).includes('00000000-0000-4000-8000-000000000003'),false);
    assert.equal(JSON.stringify(body).includes(delivery.GEAR_IMAGES_SIGNING_KEY),false);
    assert.equal(Object.hasOwn(listing.photos[0],'providerId'),false);
  }finally{db.close();}
});

test('Pages Gear listing route fails safely when binding is missing', async () => {
  const logged = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const response = await onRequestGet({ env: {} });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Gear listings are temporarily unavailable.' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(errors.length, 1);
  } finally {
    console.error = logged;
  }
});

test('Pages Gear listing route hides D1 failure details', async () => {
  const logged = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    const db = { prepare() { throw new Error('private database detail'); } };
    const response = await onRequestGet({ env: { GEAR_DB: db,...delivery } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to load Gear listings right now.' });
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][1]), /private database detail/);
  } finally {
    console.error = logged;
  }
});

test('Pages Gear listing route fails closed when signed photo delivery is not configured',async()=>{
  const logged=console.error;console.error=()=>{};const db=openLocalDatabase();
  const invalid=[
    ['GEAR_IMAGES_ACCOUNT_HASH',undefined],['GEAR_IMAGES_PUBLIC_VARIANT',undefined],['GEAR_IMAGES_SIGNING_KEY',undefined],
    ['GEAR_IMAGES_ACCOUNT_HASH','too-short'],['GEAR_IMAGES_ACCOUNT_HASH','AbCdEfGhIjKlMnOpQrStU/'],
    ...['bad/name','bad?name','bad&name','bad.name','bad%2Fname','bad\nname','x'.repeat(100)].map(value=>['GEAR_IMAGES_PUBLIC_VARIANT',value]),
    ['GEAR_IMAGES_SIGNING_KEY','too-short'],['GEAR_IMAGES_SIGNING_KEY','x'.repeat(4097)],
    ...[' '+delivery.GEAR_IMAGES_SIGNING_KEY,delivery.GEAR_IMAGES_SIGNING_KEY+'\n','test-signing key-not-secret'].map(value=>['GEAR_IMAGES_SIGNING_KEY',value]),
  ];
  try{
    assert.deepEqual(gearPhotoDeliveryConfig(delivery),{accountHash:delivery.GEAR_IMAGES_ACCOUNT_HASH,variant:delivery.GEAR_IMAGES_PUBLIC_VARIANT,signingKey:delivery.GEAR_IMAGES_SIGNING_KEY});
    for(const [field,value] of invalid){
      const env={GEAR_DB:db,...delivery};if(value===undefined)delete env[field];else env[field]=value;
      let signerCalls=0;const response=await createGearListingsHandler({signer:async()=>{signerCalls++;return async()=>[];}})({env});
      assert.equal(response.status,503,`${field}: ${String(value)}`);assert.deepEqual(await response.json(),{error:'Gear listings are temporarily unavailable.'});assert.equal(signerCalls,0);
    }
  }
  finally{db.close();console.error=logged;}
});

test('Pages Gear listing route keeps malformed references and signing failures generic',async()=>{
  const logged=console.error,errors=[];console.error=(...args)=>errors.push(args);
  const id='00000000-0000-4000-8000-000000000010',providerId='00000000-0000-4000-8000-000000000011';
  const base={id,title:'Malformed',photoRefs:[]},badRefs=[
    [{id,providerId:'private-bad-provider'}],[{id,providerId,position:0}],[null],
    Array.from({length:7},(_,index)=>({id:`00000000-0000-4000-8000-${String(index+20).padStart(12,'0')}`,providerId})),
  ];
  try{
    for(const photoRefs of badRefs){
      const handler=createGearListingsHandler({read:async()=>[{...base,photoRefs}],now:()=>1700000000123});
      const response=await handler({env:{GEAR_DB:{},...delivery}});assert.equal(response.status,500);
      const body=await response.json();assert.deepEqual(body,{error:'Unable to load Gear listings right now.'});assert.equal(JSON.stringify(body).includes('private-bad-provider'),false);assert.equal(JSON.stringify(body).includes(delivery.GEAR_IMAGES_SIGNING_KEY),false);
    }
    const handler=createGearListingsHandler({read:async()=>[base],signer:async()=>async()=>{throw new Error('private signing detail');}});
    const response=await handler({env:{GEAR_DB:{},...delivery}});assert.equal(response.status,500);assert.deepEqual(await response.json(),{error:'Unable to load Gear listings right now.'});
    assert.equal(errors.length,badRefs.length+1);
  }
  finally{console.error=logged;}
});
