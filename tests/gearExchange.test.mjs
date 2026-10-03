import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesListing, clubNames, SIZES, CLUBS, offerFields, formatPrice } from '../lib/gear-exchange.mjs';

const listing = {
  title: 'Club bag bundle', description: 'Worn zipper; repaired seam',
  category: 'Bundles', size: 'Mixed sizes', fit: 'Junior and senior bags',
  condition: 'Used — fair', city: 'Mountlake Terrace', type: 'sale',
  priceCents: 2550, clubs: ['Kent Valley', 'Other'], otherClub: 'Example Hockey',
};

test('search combines public gear, condition, city and custom club fields', () => {
  assert.equal(matchesListing(listing, { q: 'EXAMPLE repaired terrace' }), true);
  assert.equal(matchesListing({ ...listing, email: 'private@example.test' }, { q: 'private@' }), false);
  assert.equal(matchesListing(listing, { q: 'unrelated' }), false);
});
test('city ignores casing and extra whitespace, but does not match regions or partial cities', () => {
  assert.equal(matchesListing(listing, { city: '  MOUNTLAKE   terrace ' }), true);
  assert.equal(matchesListing(listing, { city: 'North Sound' }), false);
  assert.equal(matchesListing(listing, { city: 'Mountlake' }), false);
});
test('multi-club bundles and Other are independently filterable', () => {
  assert.equal(matchesListing(listing, { club: 'Kent Valley' }), true);
  assert.equal(matchesListing(listing, { club: 'Other' }), true);
  assert.equal(matchesListing(listing, { club: 'Redhawks' }), false);
  assert.deepEqual(clubNames(listing), ['Kent Valley', 'Example Hockey']);
  assert.ok(CLUBS.includes('Jr. Kraken'));
});
test('every size option can be filtered, including one-size and mixed bundles', () => {
  for (const size of SIZES) assert.equal(matchesListing({ ...listing, size }, { size }), true);
  assert.equal(matchesListing(listing, { size: 'One size' }), false);
});
test('price ceilings preserve cents, include Free, and exclude unpriced trades', () => {
  assert.equal(matchesListing(listing, { maxPrice: 25.49 }), false);
  assert.equal(matchesListing(listing, { maxPrice: 25.50 }), true);
  assert.equal(matchesListing({ ...listing, type: 'free' }, { maxPrice: 0 }), true);
  assert.equal(matchesListing({ ...listing, type: 'trade' }, { maxPrice: 100 }), false);
  assert.equal(matchesListing(listing, { maxPrice: 'bad' }), false);
  assert.equal(matchesListing(listing, { type: 'free' }), false);
});

test('inactive offer values are discarded and never searched', () => {
  assert.deepEqual(offerFields('sale', '40.50', 'hidden wish'), {priceCents:4050,trade:''});
  assert.deepEqual(offerFields('free', '40.50', 'hidden wish'), {priceCents:0,trade:''});
  assert.deepEqual(offerFields('trade', '40.50', ' pads '), {priceCents:null,trade:'pads'});
  assert.equal(matchesListing({...listing,trade:'secretwish'},{q:'secretwish'}),false);
  assert.equal(matchesListing({...listing,type:'trade',trade:'secretwish'},{q:'secretwish'}),true);
  assert.equal(formatPrice('sale',4050),'$40.50');
  assert.equal(matchesListing(listing,{maxPrice:-1}),false);
  assert.equal(matchesListing(listing,{q:''}),true);
  assert.deepEqual(clubNames({clubs:['Other'],otherClub:''}),[]);
});
