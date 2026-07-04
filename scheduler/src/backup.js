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

  const groupDO = await backupGroupDOs(env, keys, exportedAt);

  return { path, keyCount: Object.keys(keys).length, exportedAt, groupDO };
}

// Groups created by the current (post-migration) code path live entirely in
// their own GroupDO instance, not in the GROUPS KV namespace — see the
// lazy-migration comment at the top of group-do/src/group-do.js. There's no
// API to enumerate existing DO instances, so this reconstructs the candidate
// slug list from every session:{sessionId} record's groups[] entries (the
// same groupName+password pairs the app hashes into a slug via
// idFromName), matching the slug format used elsewhere:
// groupName.trim().toLowerCase() + '|' + password.trim().toLowerCase().
//
// KNOWN GAP: this only finds groups whose members have round-tripped through
// POST /api/groups/session at least once. A group that migrated to its DO
// and whose members never visit again leaves no trace in KV at all, so it
// will be silently absent from this backup — there is currently no way to
// discover it.
export async function backupGroupDOs(env, kvKeys, exportedAt = new Date().toISOString()) {
  const slugs = new Set();
  for (const [name, raw] of Object.entries(kvKeys)) {
    if (!name.startsWith('session:')) continue;
    let record;
    try { record = JSON.parse(raw); } catch { continue; }
    for (const g of record.groups ?? []) {
      const groupName = g.groupName?.trim().toLowerCase();
      const password = g.password?.trim().toLowerCase();
      if (groupName && password) slugs.add(`${groupName}|${password}`);
    }
  }

  const groups = [];
  for (const slug of slugs) {
    const stub = env.GROUP_DO.get(env.GROUP_DO.idFromName(slug));
    groups.push(await stub.export(slug));
  }

  const path = `backups/groups-do-${exportedAt.slice(0, 10)}.json`;
  const payload = JSON.stringify({ exportedAt, slugCount: slugs.size, groups });

  await env.BACKUPS.put(path, payload, {
    httpMetadata: { contentType: 'application/json' },
  });

  return { path, slugCount: slugs.size };
}
