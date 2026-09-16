import assert from 'node:assert/strict';
import test from 'node:test';

import { handleScheduleRequest } from '../functions/api/schedule.js';

const NOW = Date.parse('2026-09-16T12:30:00.000Z');
const FRESH_AT = '2026-09-16T12:00:00.000Z';
const STICK_DATA = {
  kraken: { ok: true, sessions: [{ activity: 'stick-and-puck', title: 'Stick & Puck' }] },
};
const DROP_IN_DATA = {
  kraken: { ok: true, sessions: [{ activity: 'drop-in-hockey', title: 'Drop-In' }] },
};

function context(url = 'https://postandin.com/api/schedule', groups, method = 'GET') {
  return { request: new Request(url, { method }), env: groups ? { GROUPS: groups } : {} };
}

function kvWith(values, error) {
  const reads = [];
  return {
    reads,
    async get(key, options) {
      reads.push({ key, options });
      if (error) throw error;
      return values[key] ?? null;
    },
  };
}

test('serves a fresh legacy Stick & Puck snapshot without scraping', async () => {
  const cached = { fetchedAt: FRESH_AT, data: STICK_DATA };
  const kv = kvWith({ 'schedule:cache': cached });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), STICK_DATA);
  assert.equal(response.headers.get('X-Cache'), 'HIT');
  assert.equal(response.headers.get('X-Fetched-At'), FRESH_AT);
  assert.deepEqual(kv.reads, [{ key: 'schedule:cache', options: { type: 'json' } }]);
});

test('reads the activity-specific cache', async () => {
  const kv = kvWith({
    'schedule:cache:drop-in-hockey': { fetchedAt: FRESH_AT, data: DROP_IN_DATA },
  });
  const response = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=drop-in-hockey', kv),
    { now: NOW },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), DROP_IN_DATA);
  assert.deepEqual(kv.reads.map(read => read.key), ['schedule:cache:drop-in-hockey']);
});

test('marks an old but still serviceable snapshot stale', async () => {
  const kv = kvWith({
    'schedule:cache': { fetchedAt: '2026-09-16T11:44:00.000Z', data: STICK_DATA },
  });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache'), 'STALE');
});

test('marks a carried rink stale independently of the outer snapshot', async () => {
  const data = {
    kraken: { ...STICK_DATA.kraken, stale: true, fetchedAt: '2026-09-16T11:00:00.000Z' },
  };
  const kv = kvWith({ 'schedule:cache': { fetchedAt: FRESH_AT, data } });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache'), 'STALE');
  assert.equal((await response.json()).kraken.stale, true);
});

test('masks a carried rink result after 24 hours', async () => {
  const data = {
    kraken: { ...STICK_DATA.kraken, stale: true, fetchedAt: '2026-09-15T12:29:59.000Z' },
    snoqualmie: { ok: true, sessions: [] },
  };
  const kv = kvWith({ 'schedule:cache': { fetchedAt: FRESH_AT, data } });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.kraken, {
    ok: false,
    sessions: [],
    error: 'Schedule temporarily unavailable for this rink.',
  });
  assert.equal(body.snoqualmie.ok, true);
});

test('fails closed when the snapshot is missing, malformed, future-dated, or older than 24 hours', async t => {
  const cases = [
    ['missing', null],
    ['malformed', { fetchedAt: 'not-a-date', data: STICK_DATA }],
    ['future', { fetchedAt: '2026-09-16T12:31:00.001Z', data: STICK_DATA }],
    ['expired', { fetchedAt: '2026-09-15T12:29:59.000Z', data: STICK_DATA }],
  ];
  for (const [name, cached] of cases) {
    await t.test(name, async () => {
      const kv = kvWith(cached ? { 'schedule:cache': cached } : {});
      const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('Retry-After'), '300');
      assert.deepEqual(await response.json(), { error: 'Schedule temporarily unavailable.' });
    });
  }
});

test('tolerates up to one minute of harmless clock skew', async () => {
  const data = {
    kraken: { ...STICK_DATA.kraken, fetchedAt: '2026-09-16T12:31:00.000Z' },
  };
  const kv = kvWith({
    'schedule:cache': { fetchedAt: '2026-09-16T12:31:00.000Z', data },
  });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Cache'), 'HIT');
  assert.equal((await response.json()).kraken.ok, true);
});

test('masks a rink timestamp beyond the clock-skew tolerance', async () => {
  const data = {
    kraken: { ...STICK_DATA.kraken, fetchedAt: '2026-09-16T12:31:00.001Z' },
    snoqualmie: { ok: true, sessions: [] },
  };
  const kv = kvWith({ 'schedule:cache': { fetchedAt: FRESH_AT, data } });
  const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.kraken.ok, false);
  assert.equal(body.snoqualmie.ok, true);
});

test('missing or failing KV returns a generic 503 without leaking internals', async t => {
  const cases = [
    ['missing binding', undefined],
    ['read failure', kvWith({}, new Error('secret detail'))],
  ];
  for (const [name, kv] of cases) {
    await t.test(name, async () => {
      const originalError = console.error;
      console.error = () => {};
      try {
        const response = await handleScheduleRequest(context(undefined, kv), { now: NOW });
        const body = await response.text();
        assert.equal(response.status, 503);
        assert.deepEqual(JSON.parse(body), { error: 'Schedule temporarily unavailable.' });
        assert.ok(!body.includes('secret detail'));
      } finally {
        console.error = originalError;
      }
    });
  }
});

test('HEAD returns cache metadata without a body', async () => {
  const kv = kvWith({ 'schedule:cache': { fetchedAt: FRESH_AT, data: STICK_DATA } });
  const response = await handleScheduleRequest(context(undefined, kv, 'HEAD'), { now: NOW });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('X-Cache'), 'HIT');
});

test('rejects unsupported activities and methods before reading KV', async () => {
  const kv = kvWith({});
  const unsupported = await handleScheduleRequest(
    context('https://postandin.com/api/schedule?activity=private-skate', kv),
    { now: NOW },
  );
  assert.equal(unsupported.status, 400);

  const post = await handleScheduleRequest(context(undefined, kv, 'POST'), { now: NOW });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  assert.equal(kv.reads.length, 0);
});
