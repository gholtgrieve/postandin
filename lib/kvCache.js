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
//
// Stampede control. Two layers, and NEITHER is globally atomic:
//
//   1. `inFlight` — a module-level Map of in-progress refresh promises, keyed
//      by cache key. The has()/set() pair below is fully synchronous (no await
//      between them), so no other request can interleave: within one Worker
//      isolate this is real single-flight — N concurrent stale requests produce
//      exactly one fetchFresh() call. The entry is deleted in a `finally`, so a
//      failed or throwing refresh can never wedge the key permanently.
//      LIMITATION: the Map is isolate-local memory. Cloudflare runs many
//      isolates per colo and many colos worldwide, and they share nothing, so
//      this bounds concurrent refreshes per isolate, not globally.
//
//   2. `${key}:lock` — a short-lived KV marker, retained only as a best-effort
//      throttle ACROSS isolates and colos. It is explicitly NOT atomic and NOT
//      sufficient on its own: KV has no compare-and-set, and it is eventually
//      consistent (a write can take ~60s to propagate), so two isolates can
//      both read "no lock" and both proceed to refresh. Read it as reducing the
//      expected number of duplicate upstream calls, never as mutual exclusion.
//
// Strict global serialization would require a Durable Object per cache key to
// serialize refreshes; that is real added infrastructure, and the layers above
// are enough to keep Airtable request volume well under its rate limit.
const LOCK_TTL_S = 60; // Cloudflare KV's minimum expirationTtl; also >> the 8s Airtable fetch timeout, so a healthy refresh finishes long before this expires.

// key -> promise for the refresh currently running in THIS isolate.
const inFlight = new Map();

export async function readThrough(kv, key, freshMs, staleTtlS, fetchFresh, waitUntil) {
  // No KV binding: degrade to current behavior (live upstream call).
  if (!kv) return await fetchFresh();

  const entry = await kv.get(key, { type: 'json' });

  if (entry && typeof entry.fetchedAt === 'number') {
    // Fresh: serve directly, no upstream call.
    if (Date.now() - entry.fetchedAt < freshMs) {
      return entry.data;
    }

    // Stale: serve immediately, revalidate in the background. Skip entirely if
    // this isolate is already refreshing this key. The has()/set() pair is
    // synchronous, so concurrent requests cannot interleave between them.
    if (!inFlight.has(key)) {
      const revalidate = (async () => {
        const lockKey = `${key}:lock`;
        try {
          // Cross-isolate throttle only — see the note above; not exclusion.
          if (await kv.get(lockKey)) return;
          await kv.put(lockKey, '1', { expirationTtl: LOCK_TTL_S });
        } catch (e) {
          console.error('kvCache lock failed', key, e.message, e.stack);
          return;
        }
        try {
          const data = await fetchFresh();
          await kv.put(key, JSON.stringify({ data, fetchedAt: Date.now() }), { expirationTtl: staleTtlS });
        } catch (e) {
          // Swallow: the stale value stays in KV and keeps being served.
          console.error('kvCache revalidate failed', key, e.message, e.stack);
        }
      })().finally(() => inFlight.delete(key));
      inFlight.set(key, revalidate);
      if (waitUntil) waitUntil(revalidate);
    }
    return entry.data;
  }

  // Cold: no usable entry. Fetch live (rethrow on failure) and write in the background.
  const data = await fetchFresh();
  const write = kv.put(key, JSON.stringify({ data, fetchedAt: Date.now() }), { expirationTtl: staleTtlS });
  if (waitUntil) waitUntil(write); else await write;
  return data;
}
