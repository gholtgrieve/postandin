import assert from 'node:assert/strict';
import test from 'node:test';

import { handleManualRequest } from '../scheduler/src/manual.js';

const TOKEN = 'a-secure-manual-operation-token-123456';
const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));

function request(path, { method = 'POST', token } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`https://scheduler.example${path}`, { method, headers });
}

function dependencies(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      equal,
      scrape: async () => calls.push('scrape'),
      backup: async () => calls.push('backup'),
      ...overrides,
    },
  };
}

test('manual routes reject unknown paths, non-POST methods, and missing configuration', async () => {
  const { deps } = dependencies();
  assert.equal((await handleManualRequest(request('/nope'), { ADMIN_TRIGGER_TOKEN: TOKEN }, deps)).status, 404);
  const get = await handleManualRequest(request('/trigger', { method: 'GET' }), { ADMIN_TRIGGER_TOKEN: TOKEN }, deps);
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('Allow'), 'POST');
  assert.equal((await handleManualRequest(request('/trigger'), {}, deps)).status, 503);
  assert.equal((await handleManualRequest(request('/trigger'), { ADMIN_TRIGGER_TOKEN: 'short' }, deps)).status, 503);
});

test('manual routes require the configured bearer token', async () => {
  const { deps, calls } = dependencies();
  const env = { ADMIN_TRIGGER_TOKEN: TOKEN };
  assert.equal((await handleManualRequest(request('/trigger'), env, deps)).status, 401);
  assert.equal((await handleManualRequest(request('/trigger', { token: 'wrong' }), env, deps)).status, 401);
  assert.deepEqual(calls, []);
});

test('authenticated trigger and backup requests invoke only their operation', async () => {
  const env = { ADMIN_TRIGGER_TOKEN: TOKEN };
  const trigger = dependencies();
  const triggerResponse = await handleManualRequest(request('/trigger', { token: TOKEN }), env, trigger.deps);
  assert.equal(triggerResponse.status, 200);
  assert.deepEqual(await triggerResponse.json(), { ok: true });
  assert.deepEqual(trigger.calls, ['scrape']);

  const backup = dependencies();
  const backupResponse = await handleManualRequest(request('/backup-now', { token: TOKEN }), env, backup.deps);
  assert.equal(backupResponse.status, 200);
  assert.deepEqual(await backupResponse.json(), { ok: true });
  assert.deepEqual(backup.calls, ['backup']);
});

test('manual operation failures return a generic error', async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const { deps } = dependencies({ scrape: async () => { throw new Error('sensitive upstream detail'); } });
    const response = await handleManualRequest(
      request('/trigger', { token: TOKEN }),
      { ADMIN_TRIGGER_TOKEN: TOKEN },
      deps,
    );
    const body = await response.text();
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(body), { error: 'Operation failed.' });
    assert.ok(!body.includes('sensitive upstream detail'));
  } finally {
    console.error = originalError;
  }
});
