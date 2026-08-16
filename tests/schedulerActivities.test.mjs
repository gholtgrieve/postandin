import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCHEDULE_CACHE_KEYS,
  selectActivity,
  writeScheduleCaches,
} from '../scheduler/src/index.js';

const NOW = new Date('2026-08-14T12:00:00.000Z');

function session(activity, title) {
  return { activity, title, start: '2026-08-15T12:00:00.000Z' };
}

function kvWith(initial = {}, { failOnPut } = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  return {
    values,
    writes,
    async get(key) {
      return values.get(key) ?? null;
    },
    async put(key, value, options) {
      if (key === failOnPut) throw new Error(`put failed for ${key}`);
      const parsed = JSON.parse(value);
      values.set(key, parsed);
      writes.push({ key, value: parsed, options });
    },
  };
}

test('selectActivity preserves rink results while selecting one activity', () => {
  const data = {
    kraken: {
      ok: true,
      sessions: [
        session('stick-and-puck', 'Stick & Puck'),
        session('drop-in-hockey', 'Drop-In'),
        session('public-skate', 'Public Skate'),
        session('unknown-activity', 'Unknown'),
        { title: 'Missing activity', start: '2026-08-15T12:00:00.000Z' },
      ],
    },
  };

  const selected = selectActivity(data, 'drop-in-hockey');
  assert.deepEqual(selected.kraken.sessions.map(s => s.title), ['Drop-In']);
  assert.equal(selected.kraken.ok, true);
  assert.equal(data.kraken.sessions.length, 5, 'selection must not mutate the combined scrape');
});

test('selectActivity fails only the activity whose Kent calendar failed', () => {
  const data = {
    kentValley: {
      ok: true,
      sessions: [session('stick-and-puck', 'Current Stick & Puck')],
      activityFailures: ['public-skate'],
    },
  };

  const publicSkate = selectActivity(data, 'public-skate');
  assert.deepEqual(publicSkate.kentValley, {
    ok: false,
    sessions: [],
    error: 'Schedule temporarily unavailable for this rink.',
  });

  const stick = selectActivity(data, 'stick-and-puck');
  assert.equal(stick.kentValley.ok, true);
  assert.deepEqual(stick.kentValley.sessions.map(s => s.title), ['Current Stick & Puck']);
  assert.equal('activityFailures' in stick.kentValley, false);
});

test('scheduler writes activity caches separately and preserves the legacy Stick & Puck cache shape', async () => {
  const previousAt = '2026-08-14T00:00:00.000Z';
  const kv = kvWith({
    [SCHEDULE_CACHE_KEYS['stick-and-puck']]: {
      fetchedAt: previousAt,
      data: {
        everett: { ok: true, sessions: [session('stick-and-puck', 'Previous Stick & Puck')] },
      },
    },
    [SCHEDULE_CACHE_KEYS['drop-in-hockey']]: {
      fetchedAt: previousAt,
      data: {
        everett: { ok: true, sessions: [session('drop-in-hockey', 'Previous Drop-in')] },
      },
    },
    [SCHEDULE_CACHE_KEYS['public-skate']]: {
      fetchedAt: previousAt,
      data: {
        everett: { ok: true, sessions: [session('public-skate', 'Previous Public Skate')] },
      },
    },
  });
  const data = {
    kraken: {
      ok: true,
      sessions: [
        session('stick-and-puck', 'Current Stick & Puck'),
        session('drop-in-hockey', 'Current Drop-in'),
        session('public-skate', 'Current Public Skate'),
      ],
    },
    everett: { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' },
  };

  const result = await writeScheduleCaches({ SCHEDULE: kv }, data, { now: NOW });

  assert.equal(result.updated, true);
  assert.deepEqual(kv.writes.map(write => write.key), [
    'schedule:cache:public-skate',
    'schedule:cache:drop-in-hockey',
    'schedule:cache',
  ]);
  assert.ok(kv.writes.every(write => write.options.expirationTtl === 7200));

  const publicSkate = kv.writes[0].value;
  assert.deepEqual(publicSkate.data.kraken.sessions.map(s => s.title), ['Current Public Skate']);
  assert.equal(publicSkate.data.everett.stale, true);
  assert.deepEqual(publicSkate.data.everett.sessions.map(s => s.title), ['Previous Public Skate']);

  const dropIn = kv.writes[1].value;
  assert.deepEqual(dropIn.data.kraken.sessions.map(s => s.title), ['Current Drop-in']);
  assert.equal(dropIn.data.everett.stale, true);
  assert.deepEqual(dropIn.data.everett.sessions.map(s => s.title), ['Previous Drop-in']);

  const stick = kv.writes[2].value;
  assert.deepEqual(stick.data.kraken.sessions.map(s => s.title), ['Current Stick & Puck']);
  assert.equal(stick.data.everett.stale, true);
  assert.deepEqual(stick.data.everett.sessions.map(s => s.title), ['Previous Stick & Puck']);
  assert.deepEqual(Object.keys(stick), ['fetchedAt', 'data']);
});

test('an all-failed scrape leaves both existing activity caches untouched', async () => {
  const kv = kvWith();
  const result = await writeScheduleCaches({ SCHEDULE: kv }, {
    kraken: { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' },
  }, { now: NOW });

  assert.deepEqual(result, { updated: false });
  assert.equal(kv.writes.length, 0);
});

test('a previous rink result older than 24 hours is not carried forward', async () => {
  const kv = kvWith({
    'schedule:cache:drop-in-hockey': {
      fetchedAt: '2026-08-13T11:59:59.000Z',
      data: {
        everett: { ok: true, sessions: [session('drop-in-hockey', 'Expired Drop-in')] },
      },
    },
  });

  await writeScheduleCaches({ SCHEDULE: kv }, {
    kraken: { ok: true, sessions: [session('stick-and-puck', 'Current Stick & Puck')] },
    everett: { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' },
  }, { now: NOW });

  assert.equal(kv.writes[0].value.data.everett.ok, false);
  assert.equal(kv.writes[0].value.data.everett.stale, undefined);
});

test('a malformed previous timestamp is rejected instead of carried forward', async () => {
  const kv = kvWith({
    'schedule:cache:drop-in-hockey': {
      fetchedAt: 'not-a-date',
      data: {
        everett: { ok: true, sessions: [session('drop-in-hockey', 'Malformed timestamp')] },
      },
    },
  });

  await writeScheduleCaches({ SCHEDULE: kv }, {
    kraken: { ok: true, sessions: [session('stick-and-puck', 'Current Stick & Puck')] },
    everett: { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' },
  }, { now: NOW });

  assert.equal(kv.writes[0].value.data.everett.ok, false);
  assert.equal(kv.writes[0].value.data.everett.stale, undefined);
});

test('an honest empty activity result replaces stale nonempty data', async () => {
  const kv = kvWith({
    'schedule:cache:drop-in-hockey': {
      fetchedAt: '2026-08-14T00:00:00.000Z',
      data: {
        kraken: { ok: true, sessions: [session('drop-in-hockey', 'Previous Drop-in')] },
      },
    },
  });

  await writeScheduleCaches({ SCHEDULE: kv }, {
    kraken: { ok: true, sessions: [session('stick-and-puck', 'Current Stick & Puck')] },
  }, { now: NOW });

  assert.equal(kv.writes[0].value.data.kraken.ok, true);
  assert.deepEqual(kv.writes[0].value.data.kraken.sessions, []);
  assert.equal(kv.writes[0].value.data.kraken.stale, undefined);
});

test('a failed legacy write leaves its prior value intact after the Drop-in write succeeds', async () => {
  const priorLegacy = {
    fetchedAt: '2026-08-14T00:00:00.000Z',
    data: {
      kraken: { ok: true, sessions: [session('stick-and-puck', 'Previous Stick & Puck')] },
    },
  };
  const kv = kvWith({ 'schedule:cache': priorLegacy }, { failOnPut: 'schedule:cache' });
  const data = {
    kraken: {
      ok: true,
      sessions: [
        session('stick-and-puck', 'Current Stick & Puck'),
        session('drop-in-hockey', 'Current Drop-in'),
      ],
    },
  };

  await assert.rejects(
    writeScheduleCaches({ SCHEDULE: kv }, data, { now: NOW }),
    /put failed for schedule:cache/,
  );

  assert.deepEqual(kv.writes.map(write => write.key), [
    'schedule:cache:public-skate',
    'schedule:cache:drop-in-hockey',
  ]);
  assert.deepEqual(kv.values.get('schedule:cache'), priorLegacy);
  assert.deepEqual(
    kv.values.get('schedule:cache:drop-in-hockey').data.kraken.sessions.map(s => s.title),
    ['Current Drop-in'],
  );
});
