import test from 'node:test';
import assert from 'node:assert/strict';
import { openLocalDatabase } from '../scripts/gear/local-db.mjs';
import { createDraft } from '../lib/gear-storage.mjs';
import { onRequestGet } from '../functions/api/gear/listings.js';

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

    const response = await onRequestGet({ env: { GEAR_DB: db } });
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

    const response = await onRequestGet({ env: { GEAR_DB: db } });
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
    const response = await onRequestGet({ env: { GEAR_DB: db } });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to load Gear listings right now.' });
    assert.equal(errors.length, 1);
    assert.match(String(errors[0][1]), /private database detail/);
  } finally {
    console.error = logged;
  }
});
