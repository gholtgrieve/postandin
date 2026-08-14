import assert from 'node:assert/strict';
import test from 'node:test';

import { handleScheduleRequest } from '../functions/api/schedule.js';

const STICK_DATA = {
  kraken: { ok: true, sessions: [{ activity: 'stick-and-puck', title: 'Stick & Puck' }] },
};
const DROP_IN_DATA = {
  kraken: { ok: true, sessions: [{ activity: 'drop-in-hockey', title: 'Drop-In' }] },
};

function context(url = 'https://postandin.com/api/schedule', groups) {
  return { request: new Request(url), env: groups ? { GROUPS: groups } : {} };
}

function kvWith(values) {
  const reads = [];
  return {
    reads,
    async get(key, options) {
      reads.push({ key, options });
      return values[key] ?? null;
    },
  };
}

test('omitting activity preserves the legacy Stick & Puck cache contract', async () => {
  const cached = { fetchedAt: '2026-08-14T12:00:00.000Z', data: STICK_DATA };
  const kv = kvWith({ 'schedule:cache': cached });
  const response = await handleScheduleRequest(context(undefined, kv), {
    scrape: async () => assert.fail('a cache hit must not scrape'),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), STICK_DATA);
  assert.equal(response.headers.get('X-Cache'), 'HIT');
  assert.equal(response.headers.get('X-Fetched-At'), cached.fetchedAt);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=120');
  assert.deepEqual(kv.reads, [{ key: 'schedule:cache', options: { type: 'json' } }]);
});

test('explicit Stick & Puck uses the same legacy cache key', async () => {
  const kv = kvWith({ 'schedule:cache': { data: STICK_DATA } });
  const response = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=stick-and-puck', kv),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), STICK_DATA);
  assert.deepEqual(kv.reads.map(read => read.key), ['schedule:cache']);
});

test('Drop-in Hockey uses its activity-specific cache', async () => {
  const kv = kvWith({
    'schedule:cache:drop-in-hockey': { data: DROP_IN_DATA },
  });
  const response = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=drop-in-hockey', kv),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), DROP_IN_DATA);
  assert.deepEqual(kv.reads.map(read => read.key), ['schedule:cache:drop-in-hockey']);
});

test('a cache miss scrapes only the requested activity', async () => {
  const kv = kvWith({});
  const requested = [];
  const response = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=drop-in-hockey', kv),
    {
      scrape: async options => {
        requested.push(options);
        return DROP_IN_DATA;
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), DROP_IN_DATA);
  assert.equal(response.headers.get('X-Cache'), 'MISS');
  assert.deepEqual(requested, [{ activities: ['drop-in-hockey'] }]);
});

test('an unsupported activity returns a safe 400 without reading KV or scraping', async () => {
  const kv = kvWith({});
  let scraped = false;
  const response = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=private-skate', kv),
    { scrape: async () => { scraped = true; } },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Unsupported activity.' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(kv.reads.length, 0);
  assert.equal(scraped, false);
});

test('an upstream failure returns a generic error without exposing internals', async () => {
  const secretDetail = 'private upstream URL and binding name';
  const originalError = console.error;
  console.error = () => {};

  try {
    const response = await handleScheduleRequest(context(), {
      scrape: async () => { throw new Error(secretDetail); },
    });
    const body = await response.text();

    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(body), { error: 'Schedule temporarily unavailable.' });
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.ok(!body.includes(secretDetail));
  } finally {
    console.error = originalError;
  }
});
