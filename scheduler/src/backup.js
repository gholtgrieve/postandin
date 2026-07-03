// Daily full backup of the GROUPS KV namespace to R2.
//
// Runs on its own cron schedule (see index.js), separate from the
// schedule-cache job — this exists to back up group/rsvp/session app data
// after an incident where a bad purge wiped GROUPS in production with no
// backup and no way to recover it.
//
// Note: GROUPS and SCHEDULE (see wrangler.toml) are bound to the same
// underlying KV namespace, so a full-namespace backup also captures the
// schedule:cache key. That's harmless — it's regenerated every 30 minutes —
// but it means each backup file is a full namespace snapshot, not strictly
// "groups only".
export async function backupGroups(env) {
  const keys = {};
  let cursor;
  do {
    const list = await env.GROUPS.list({ cursor });
    for (const k of list.keys) {
      keys[k.name] = await env.GROUPS.get(k.name);
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);

  const exportedAt = new Date().toISOString();
  const path = `backups/groups-${exportedAt.slice(0, 10)}.json`;
  const payload = JSON.stringify({ exportedAt, keys });

  await env.BACKUPS.put(path, payload, {
    httpMetadata: { contentType: 'application/json' },
  });

  return { path, keyCount: Object.keys(keys).length, exportedAt };
}
