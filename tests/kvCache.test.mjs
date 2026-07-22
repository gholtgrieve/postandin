// Run with: node --test tests/kvCache.test.mjs   (Node >= 18)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readThrough } from '../lib/kvCache.js';

const FRESH_MS = 5 * 60 * 1000;
const STALE_TTL_S = 24 * 60 * 60;

// Each test uses its own cache key: readThrough keeps a module-level in-flight
// map keyed by cache key, and the mock KV holds `${key}:lock` markers, so
// sharing a key across tests would leak state between them.
function staleEntry(data) {
  return JSON.stringify({ data, fetchedAt: Date.now() - 10 * 60 * 1000 });
}
function freshEntry(data) {
  return JSON.stringify({ data, fetchedAt: Date.now() });
}

function makeKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, opts) {
      const raw = store.get(key);
      if (raw === undefined) return null;
      if (opts && opts.type === 'json') return JSON.parse(raw);
      return raw;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

function collectWaitUntil() {
  const tasks = [];
  return { waitUntil: (p) => tasks.push(p), flush: () => Promise.all(tasks) };
}

test('fresh entry makes no upstream call', async () => {
  const kv = makeKv({ 'k-fresh': freshEntry('cached') });
  let calls = 0;
  const { waitUntil, flush } = collectWaitUntil();
  const result = await readThrough(kv, 'k-fresh', FRESH_MS, STALE_TTL_S, async () => { calls++; return 'fresh'; }, waitUntil);
  await flush();
  assert.equal(result, 'cached');
  assert.equal(calls, 0);
});

test('stale entry is returned immediately, refresh happens in background', async () => {
  const kv = makeKv({ 'k-stale': staleEntry('stale-data') });
  let calls = 0;
  const { waitUntil, flush } = collectWaitUntil();
  const result = await readThrough(kv, 'k-stale', FRESH_MS, STALE_TTL_S, async () => { calls++; return 'refreshed'; }, waitUntil);
  assert.equal(result, 'stale-data'); // returned before the background refresh is awaited
  await flush();
  assert.equal(calls, 1);
  assert.equal(JSON.parse(kv.store.get('k-stale')).data, 'refreshed');
});

test('concurrent stale requests trigger only one upstream refresh', async () => {
  const kv = makeKv({ 'k-conc': staleEntry('stale-data') });
  let calls = 0;
  const fetchFresh = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 20));
    return 'refreshed';
  };
  const { waitUntil, flush } = collectWaitUntil();
  const results = await Promise.all([
    readThrough(kv, 'k-conc', FRESH_MS, STALE_TTL_S, fetchFresh, waitUntil),
    readThrough(kv, 'k-conc', FRESH_MS, STALE_TTL_S, fetchFresh, waitUntil),
    readThrough(kv, 'k-conc', FRESH_MS, STALE_TTL_S, fetchFresh, waitUntil),
  ]);
  assert.deepEqual(results, ['stale-data', 'stale-data', 'stale-data']);
  await flush();
  assert.equal(calls, 1, `expected exactly 1 upstream refresh, got ${calls}`);
});

test('failed refresh leaves stale data in place and does not throw', async () => {
  const kv = makeKv({ 'k-fail': staleEntry('stale-data') });
  const { waitUntil, flush } = collectWaitUntil();
  const result = await readThrough(kv, 'k-fail', FRESH_MS, STALE_TTL_S, async () => { throw new Error('upstream down'); }, waitUntil);
  assert.equal(result, 'stale-data');
  await assert.doesNotReject(flush());
  assert.equal(JSON.parse(kv.store.get('k-fail')).data, 'stale-data');
});

test('a failed refresh releases the in-flight slot so a later refresh can run', async () => {
  const kv = makeKv({ 'k-retry': staleEntry('stale-data') });
  let calls = 0;

  const first = collectWaitUntil();
  await readThrough(kv, 'k-retry', FRESH_MS, STALE_TTL_S, async () => { calls++; throw new Error('upstream down'); }, first.waitUntil);
  await first.flush();
  assert.equal(calls, 1);

  // Clear the cross-isolate KV marker (it survives on a 60s TTL by design) so
  // this asserts specifically that the in-flight map entry was released.
  kv.store.delete('k-retry:lock');

  const second = collectWaitUntil();
  const result = await readThrough(kv, 'k-retry', FRESH_MS, STALE_TTL_S, async () => { calls++; return 'recovered'; }, second.waitUntil);
  assert.equal(result, 'stale-data');
  await second.flush();
  assert.equal(calls, 2, 'second refresh should have been allowed to start');
  assert.equal(JSON.parse(kv.store.get('k-retry')).data, 'recovered');
});

test('cold cache fetches upstream and stores the result', async () => {
  const kv = makeKv();
  let calls = 0;
  const { waitUntil, flush } = collectWaitUntil();
  const result = await readThrough(kv, 'k-cold', FRESH_MS, STALE_TTL_S, async () => { calls++; return 'first-fetch'; }, waitUntil);
  assert.equal(result, 'first-fetch');
  assert.equal(calls, 1);
  await flush();
  assert.equal(JSON.parse(kv.store.get('k-cold')).data, 'first-fetch');
});

test('cold cache rethrows when the upstream fetch fails', async () => {
  const kv = makeKv();
  const { waitUntil } = collectWaitUntil();
  await assert.rejects(
    readThrough(kv, 'k-cold-fail', FRESH_MS, STALE_TTL_S, async () => { throw new Error('upstream down'); }, waitUntil),
    /upstream down/,
  );
});

test('missing KV binding falls back to a direct upstream call', async () => {
  let calls = 0;
  const result = await readThrough(undefined, 'k-nokv', FRESH_MS, STALE_TTL_S, async () => { calls++; return 'direct'; }, () => {});
  assert.equal(result, 'direct');
  assert.equal(calls, 1);
});
