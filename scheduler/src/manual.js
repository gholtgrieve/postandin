// Operational routes fail closed until a strong secret is configured.
export async function handleManualRequest(request, env, {
  scrape, backup,
  equal = (a, b) => crypto.subtle.timingSafeEqual(a, b),
}) {
  const path = new URL(request.url).pathname;
  if (!['/trigger', '/backup-now'].includes(path)) return reply(404, { error: 'Not found.' });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' }, { Allow: 'POST' });
  const expected = env.ADMIN_TRIGGER_TOKEN;
  if (typeof expected !== 'string' || expected.length < 32) {
    return reply(503, { error: 'Manual operations unavailable.' });
  }
  const authorization = request.headers.get('Authorization') ?? '';
  const token = /^Bearer ([^\s]+)$/i.exec(authorization)?.[1];
  if (!token || token.length > 1024) return reply(401, { error: 'Unauthorized.' });
  const encode = new TextEncoder();
  // Fixed-length digests avoid throwing on different token lengths.
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encode.encode(token)),
    crypto.subtle.digest('SHA-256', encode.encode(expected)),
  ]);
  if (!equal(actualHash, expectedHash)) return reply(401, { error: 'Unauthorized.' });
  try {
    if (path === '/trigger') {
      await scrape(env);
      return reply(200, { ok: true });
    }
    await backup(env);
    return reply(200, { ok: true });
  } catch {
    console.error('manual operation failed', path === '/trigger' ? 'scrape' : 'backup');
    return reply(502, { error: 'Operation failed.' });
  }
}
function reply(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
