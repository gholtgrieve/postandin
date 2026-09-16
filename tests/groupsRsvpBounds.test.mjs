import assert from 'node:assert/strict';
import test from 'node:test';

import { onRequest } from '../functions/api/groups/rsvp.js';

function groupDo() {
  const calls = [];
  return {
    calls,
    idFromName(slug) { return slug; },
    get(id) {
      return { async getRsvp(slug) { calls.push([id, slug]); return { session: ['Alex'] }; } };
    },
  };
}

async function get(raw, binding = groupDo()) {
  return {
    binding,
    response: await onRequest({
      request: new Request(`https://postandin.com/api/groups/rsvp?groupSlugs=${encodeURIComponent(raw)}`),
      env: { GROUP_DO: binding },
    }),
  };
}

test('RSVP batch reads deduplicate group slugs', async () => {
  const { binding, response } = await get('team|secret,team|secret,other|secret');
  assert.equal(response.status, 200);
  assert.equal(binding.calls.length, 2);
  assert.deepEqual(Object.keys(await response.json()), ['team|secret', 'other|secret']);
});

test('RSVP batch reads reject oversized and malformed group lists before DO calls', async t => {
  const cases = [
    ['more than 20 groups', Array.from({ length: 21 }, (_, i) => `g${i}|secret`).join(',')],
    ['malformed slug', 'missing-separator'],
    ['oversized slug', `${'a'.repeat(81)}|x`],
    ['oversized raw query', `${'a'.repeat(4096)}|x`],
  ];
  for (const [name, raw] of cases) {
    await t.test(name, async () => {
      const { binding, response } = await get(raw);
      assert.equal(response.status, 400);
      assert.equal(binding.calls.length, 0);
    });
  }
});
