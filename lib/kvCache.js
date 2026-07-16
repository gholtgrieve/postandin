// Generic read-through KV cache with stale-while-revalidate + serve-stale-on-error.
//
// readThrough(kv, key, freshMs, staleTtlS, fetchFresh, waitUntil)
//   kv         : KV binding (may be undefined)
//   key        : cache key string
//   freshMs    : entry younger than this is served directly, no upstream call
//   staleTtlS  : KV expirationTtl in seconds (>> freshMs) so a stale copy
//                survives long enough to serve during an outage
//   fetchFresh : async () => data   (throws on upstream failure)
//   waitUntil  : context.waitUntil (for background revalidation)
// Returns the data. Throws ONLY when there is no cached entry AND fetchFresh throws.

export async function readThrough(kv, key, freshMs, staleTtlS, fetchFresh, waitUntil) {
  // No KV binding: degrade to current behavior (live upstream call).
  if (!kv) return await fetchFresh();

  const entry = await kv.get(key, { type: 'json' });

  if (entry && typeof entry.fetchedAt === 'number') {
    // Fresh: serve directly, no upstream call.
    if (Date.now() - entry.fetchedAt < freshMs) {
      return entry.data;
    }

    // Stale: serve immediately, revalidate in the background.
    const revalidate = (async () => {
      try {
        const data = await fetchFresh();
        await kv.put(key, JSON.stringify({ data, fetchedAt: Date.now() }), { expirationTtl: staleTtlS });
      } catch (e) {
        console.error('kvCache revalidate failed', key, e.message, e.stack);
      }
    })();
    if (waitUntil) waitUntil(revalidate);
    return entry.data;
  }

  // Cold: no usable entry. Fetch live (rethrow on failure) and write in the background.
  const data = await fetchFresh();
  const write = kv.put(key, JSON.stringify({ data, fetchedAt: Date.now() }), { expirationTtl: staleTtlS });
  if (waitUntil) waitUntil(write); else await write;
  return data;
}
