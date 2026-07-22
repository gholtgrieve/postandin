// Run with: node --test tests/coachPreview.test.mjs   (Node >= 18)
import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as ssrOnRequest } from '../functions/coaches/[slug].js';
import { onRequest as apiOnRequest } from '../functions/api/coach/[slug].js';

const EXPECTED_FORMULA_FOR = (slug) => `AND({slug} = "${slug}", OR({status} = "Live", {status} = "Draft"))`;

function mockAirtable(records) {
  let lastUrl = null;
  const fetchImpl = async (url) => {
    lastUrl = url.toString();
    return { ok: true, json: async () => ({ records }) };
  };
  return { fetchImpl, getLastUrl: () => lastUrl };
}

function fields(overrides) {
  return {
    name: 'Jane Doe', slug: 'jane-doe', status: 'Live',
    ...overrides,
  };
}

async function withMockedFetch(fetchImpl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = fetchImpl;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

function makeContext(slug, kv) {
  return {
    params: { slug },
    env: { AIRTABLE_API_KEY: 'key', AIRTABLE_BASE_ID: 'base', GROUPS: kv },
    waitUntil: () => {},
  };
}

// The cache key both endpoints must share. Kept as a literal (not built from
// the source) so the test fails if either endpoint's key drifts.
const CACHE_KEY = (slug) => `coaches:profile:v2:${slug}`;
const LEGACY_KEY = (slug) => `coaches:profile:${slug}`;

// Mock KV that records every key read, so tests can assert which namespace was used.
function makeRecordingKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  const reads = [];
  return {
    store,
    reads,
    async get(key, opts) {
      reads.push(key);
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

// A cached readThrough entry holding a raw Airtable record, fresh (not stale),
// so it is served directly with no upstream call.
function cachedRecord(recordFields) {
  return JSON.stringify({
    data: { id: 'recCached', fields: recordFields },
    fetchedAt: Date.now(),
  });
}

const ARCHIVED_FIELDS = {
  name: 'Archived Coach',
  slug: 'archived-coach',
  status: 'Archived',
  contact_email: 'private@example.com',
  contact_preference: ['Email'],
};

test('SSR: Live coach slug returns the profile without a draft banner', async () => {
  const { fetchImpl, getLastUrl } = mockAirtable([{ fields: fields({ status: 'Live' }) }]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await ssrOnRequest(makeContext('jane-doe'));
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /Jane Doe/);
    assert.doesNotMatch(body, /DRAFT — NOT YET PUBLISHED/);
    const formula = new URL(getLastUrl()).searchParams.get('filterByFormula');
    assert.equal(formula, EXPECTED_FORMULA_FOR('jane-doe'));
  });
});

test('SSR: Draft coach slug returns the profile with the draft banner', async () => {
  const { fetchImpl } = mockAirtable([{ fields: fields({ status: 'Draft' }) }]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await ssrOnRequest(makeContext('jane-doe'));
    const body = await res.text();
    assert.equal(res.status, 200);
    assert.match(body, /DRAFT — NOT YET PUBLISHED/);
  });
});

test('SSR: non-Live/Draft status (excluded by Airtable formula) returns 404', async () => {
  // Airtable's OR({status}="Live",{status}="Draft") filter means an Archived/
  // rejected record simply never comes back in `records` — emulate that.
  const { fetchImpl } = mockAirtable([]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await ssrOnRequest(makeContext('archived-coach'));
    assert.equal(res.status, 404);
  });
});

test('API: Live coach slug returns 200 JSON', async () => {
  const { fetchImpl } = mockAirtable([{ id: 'rec1', fields: fields({ status: 'Live' }) }]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await apiOnRequest(makeContext('jane-doe'));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.name, 'Jane Doe');
  });
});

test('API: Draft coach slug returns 200 JSON', async () => {
  const { fetchImpl } = mockAirtable([{ id: 'rec1', fields: fields({ status: 'Draft' }) }]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await apiOnRequest(makeContext('jane-doe'));
    assert.equal(res.status, 200);
  });
});

test('API: non-Live/Draft status returns 404', async () => {
  const { fetchImpl } = mockAirtable([]);
  await withMockedFetch(fetchImpl, async () => {
    const res = await apiOnRequest(makeContext('archived-coach'));
    assert.equal(res.status, 404);
  });
});

test('formula sent to Airtable requires slug match AND (Live OR Draft)', async () => {
  const { fetchImpl, getLastUrl } = mockAirtable([{ id: 'rec1', fields: fields() }]);
  await withMockedFetch(fetchImpl, async () => {
    await apiOnRequest(makeContext('jane-doe'));
    const url = new URL(getLastUrl());
    const formula = url.searchParams.get('filterByFormula');
    assert.equal(formula, EXPECTED_FORMULA_FOR('jane-doe'));
  });
});

// ── Cache-key versioning regressions ────────────────────────────────────────
// Bumping the Airtable formula does not invalidate entries cached under the old
// key, so an Archived record cached pre-change could still be served from KV
// without the Live/Draft filter ever running.

test('API endpoint reads the v2 cache key', async () => {
  const kv = makeRecordingKv({ [CACHE_KEY('jane-doe')]: cachedRecord(fields({ status: 'Live' })) });
  const { fetchImpl } = mockAirtable([]);
  await withMockedFetch(fetchImpl, async () => {
    await apiOnRequest(makeContext('jane-doe', kv));
  });
  assert.equal(kv.reads[0], CACHE_KEY('jane-doe'));
});

test('SSR endpoint reads the v2 cache key', async () => {
  const kv = makeRecordingKv({ [CACHE_KEY('jane-doe')]: cachedRecord(fields({ status: 'Live' })) });
  const { fetchImpl } = mockAirtable([]);
  await withMockedFetch(fetchImpl, async () => {
    await ssrOnRequest(makeContext('jane-doe', kv));
  });
  assert.equal(kv.reads[0], CACHE_KEY('jane-doe'));
});

test('SSR and API endpoints use the identical cache key', async () => {
  const apiKv = makeRecordingKv();
  const ssrKv = makeRecordingKv();
  const { fetchImpl } = mockAirtable([{ id: 'rec1', fields: fields() }]);
  await withMockedFetch(fetchImpl, async () => {
    await apiOnRequest(makeContext('shared-slug', apiKv));
    await ssrOnRequest(makeContext('shared-slug', ssrKv));
  });
  assert.equal(apiKv.reads[0], ssrKv.reads[0]);
  assert.equal(apiKv.reads[0], CACHE_KEY('shared-slug'));
});

test('API: legacy-key Archived entry is ignored, Airtable is consulted, result is 404', async () => {
  const kv = makeRecordingKv({ [LEGACY_KEY('archived-coach')]: cachedRecord(ARCHIVED_FIELDS) });
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls++; return { ok: true, json: async () => ({ records: [] }) }; };
  await withMockedFetch(fetchImpl, async () => {
    const res = await apiOnRequest(makeContext('archived-coach', kv));
    const body = await res.text();
    assert.equal(res.status, 404, 'legacy cached Archived record must not be served');
    assert.equal(fetchCalls, 1, 'must fall through to Airtable rather than serve the legacy entry');
    assert.doesNotMatch(body, /private@example\.com/, 'private contact info must not leak');
  });
  assert.ok(!kv.reads.includes(LEGACY_KEY('archived-coach')), 'legacy key must never be read');
});

test('SSR: legacy-key Archived entry is ignored, Airtable is consulted, result is 404', async () => {
  const kv = makeRecordingKv({ [LEGACY_KEY('archived-coach')]: cachedRecord(ARCHIVED_FIELDS) });
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls++; return { ok: true, json: async () => ({ records: [] }) }; };
  await withMockedFetch(fetchImpl, async () => {
    const res = await ssrOnRequest(makeContext('archived-coach', kv));
    const body = await res.text();
    assert.equal(res.status, 404, 'legacy cached Archived record must not be served');
    assert.equal(fetchCalls, 1, 'must fall through to Airtable rather than serve the legacy entry');
    assert.doesNotMatch(body, /private@example\.com/, 'private contact info must not leak');
    assert.doesNotMatch(body, /Archived Coach/);
  });
});

test('a valid record cached under the v2 key is served without hitting Airtable', async () => {
  const kv = makeRecordingKv({ [CACHE_KEY('jane-doe')]: cachedRecord(fields({ status: 'Live' })) });
  let fetchCalls = 0;
  const fetchImpl = async () => { fetchCalls++; return { ok: true, json: async () => ({ records: [] }) }; };
  await withMockedFetch(fetchImpl, async () => {
    const res = await apiOnRequest(makeContext('jane-doe', kv));
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.name, 'Jane Doe');
    assert.equal(fetchCalls, 0, 'a fresh v2 cache entry must be served directly');
  });
});
