import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest as everett } from '../functions/api/everett.js';
import { onRequest as rectimes } from '../functions/api/rectimes.js';

const fetchedAt = new Date().toISOString();

function context(url, data, method = 'GET') {
  const reads = [];
  return {
    reads,
    value: {
      request: new Request(url, { method }),
      env: {
        GROUPS: {
          async get(key) {
            reads.push(key);
            return { fetchedAt, data };
          },
        },
      },
    },
  };
}

test('RecTimes compatibility endpoint serves the scheduler snapshot', async () => {
  const ctx = context('https://postandin.com/api/rectimes?venueId=1145', {
    olympicview: { ok: true, sessions: [{ id: 'session-1' }] },
    lynnwood: { ok: true, sessions: [{ id: 'session-2' }] },
  });
  const response = await rectimes(ctx.value);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, sessions: [{ id: 'session-1' }] });
  assert.deepEqual(ctx.reads, ['schedule:cache']);
  assert.equal(response.headers.get('X-Cache'), 'HIT');
});

test('RecTimes compatibility endpoint rejects an unsupported venue without reading KV', async () => {
  const ctx = context('https://postandin.com/api/rectimes?venueId=9999', {});
  const response = await rectimes(ctx.value);
  assert.equal(response.status, 400);
  assert.deepEqual(ctx.reads, []);
});

test('Everett compatibility endpoint reconstructs the legacy rink and slot shape', async () => {
  const ctx = context(
    'https://postandin.com/api/everett?startDate=2026-09-16&endDate=2026-09-30',
    {
      everett: {
        ok: true,
        sessions: [
          {
            id: 'everett-42',
            start: '2026-09-20T10:00:00',
            end: '2026-09-20T11:00:00',
            title: 'Stick & Puck',
            sourceLabel: 'Stick and Puck',
            sheet: 'Community Rink',
          },
          {
            id: 'everett-99',
            start: '2026-10-01T10:00:00',
            end: '2026-10-01T11:00:00',
            title: 'Outside requested range',
            sheet: 'Main Rink',
          },
        ],
      },
    },
  );
  const response = await everett(ctx.value);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [
    {
      name: 'Community Rink',
      slots: [{
        id: '42',
        title: 'Stick and Puck',
        startDate: '2026-09-20',
        startTime: '10:00:00',
        endTime: '11:00:00',
      }],
    },
    { name: 'Main Rink', slots: [] },
  ]);
  assert.deepEqual(ctx.reads, ['schedule:cache']);
});

test('Everett compatibility endpoint preserves required date parameters', async () => {
  const ctx = context('https://postandin.com/api/everett', {});
  const response = await everett(ctx.value);
  assert.equal(response.status, 400);
  assert.deepEqual(ctx.reads, []);
});

test('compatibility endpoints support HEAD without parsing an empty body', async () => {
  const rectimesContext = context(
    'https://postandin.com/api/rectimes?venueId=1145',
    { olympicview: { ok: true, sessions: [] } },
    'HEAD',
  );
  const rectimesResponse = await rectimes(rectimesContext.value);
  assert.equal(rectimesResponse.status, 200);
  assert.equal(await rectimesResponse.text(), '');
  assert.equal(rectimesResponse.headers.get('X-Cache'), 'HIT');

  const everettContext = context(
    'https://postandin.com/api/everett?startDate=2026-09-16&endDate=2026-09-30',
    { everett: { ok: true, sessions: [] } },
    'HEAD',
  );
  const everettResponse = await everett(everettContext.value);
  assert.equal(everettResponse.status, 200);
  assert.equal(await everettResponse.text(), '');
  assert.equal(everettResponse.headers.get('X-Cache'), 'HIT');
});

test('compatibility endpoints preserve schedule-cache failure responses', async () => {
  const ctx = context('https://postandin.com/api/rectimes?venueId=1145', undefined);
  const response = await rectimes(ctx.value);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'Schedule temporarily unavailable.' });
});

test('Everett HEAD matches GET when the rink snapshot is unavailable', async () => {
  const data = {
    everett: { ok: false, sessions: [], error: 'Schedule temporarily unavailable for this rink.' },
  };
  const getResponse = await everett(context(
    'https://postandin.com/api/everett?startDate=2026-09-16&endDate=2026-09-30',
    data,
  ).value);
  const headResponse = await everett(context(
    'https://postandin.com/api/everett?startDate=2026-09-16&endDate=2026-09-30',
    data,
    'HEAD',
  ).value);

  assert.equal(getResponse.status, 502);
  assert.equal(headResponse.status, getResponse.status);
  assert.equal(await headResponse.text(), '');
});
