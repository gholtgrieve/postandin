# postandin-scheduler

A standalone Cloudflare Worker with two independent cron jobs:

1. **Schedule cache** (every 30 min) — scrapes all rink schedules and writes the
   result to KV. The Pages site's `/api/schedule` endpoint reads from this cache
   instead of scraping on every visitor request.
2. **GROUPS backup** (daily) — exports the entire GROUPS KV namespace to R2. See
   [GROUPS backups](#groups-backups-data-safety-layer) below — read that section
   *before* you need it, i.e. before running any bulk-delete/reset operation.

## How the two pieces fit together

| Piece | Deploy path | Trigger |
|---|---|---|
| **Pages site** (`functions/`, `stick-and-puck/`, etc.) | Auto-deploys from GitHub `main` via Cloudflare Pages | Git push |
| **Scheduler Worker** (`scheduler/`) | **Requires a manual `wrangler deploy`** — not deployed by Pages | Cron (every 30 min + daily) |

**Pushing to GitHub does NOT update the scheduler.** Run `wrangler deploy` from
`scheduler/` each time you change scraping *or backup* logic.

## First-time setup

1. **Install Wrangler** (if not already): `npm i -g wrangler && wrangler login`

2. **Find your KV namespace ID**
   - Cloudflare dashboard → Workers & Pages → KV
   - Click the namespace that your Pages project uses for `GROUPS`
   - Copy the ID from the URL or the details pane

3. **Set the ID in wrangler.toml**
   - Edit `scheduler/wrangler.toml`
   - Replace `REPLACE_WITH_YOUR_GROUPS_KV_NAMESPACE_ID` with the actual ID

4. **Deploy the scheduler**
   ```sh
   cd scheduler
   wrangler deploy
   ```

5. **Verify**
   - In the Cloudflare dashboard, go to Workers & Pages → `postandin-scheduler`
   - Check the Cron Triggers tab — you should see `*/30 * * * *`
   - Optionally trigger a manual run via the `/trigger` endpoint:
     ```sh
     curl https://postandin-scheduler.<your-subdomain>.workers.dev/trigger
     ```
   - After the first successful run, check KV for the `schedule:cache` key

## GROUPS backups (data-safety layer)

This exists because a destructive cleanup command once wiped the entire GROUPS
KV namespace in production with no backup and no safeguard. Read this section
*before* you need it.

**What gets backed up:** two separate objects are written on every run:

1. `backups/groups-YYYY-MM-DD.json` — the entire GROUPS KV namespace: every
   remaining `group:`, `session:`, and `rsvp:`-style key. Note that GROUPS and
   SCHEDULE are bound to the *same underlying KV namespace* (see
   `wrangler.toml`), so this also captures the `schedule:cache` key. That's
   harmless (it's regenerated every 30 min) — it just means this file is a
   full namespace snapshot, not strictly "groups only".

2. `backups/groups-do-YYYY-MM-DD.json` — a separate export of group data that
   lives in a **GroupDO Durable Object** instead of KV. Since the
   `group-do-migration` change, each group's membership + RSVPs move out of
   KV into a per-group Durable Object the first time any member touches it
   (see the migration comment at the top of `group-do/src/group-do.js`); once
   that happens its `group:<slug>` and `rsvp:<slug>` KV keys are deleted, so
   part 1 above no longer sees that group at all.

   There is no API to enumerate existing DO instances, so this backup can only
   *guess* which groups exist: it scans every `session:{sessionId}` record
   found in part 1 for `groups[].groupName`/`password` pairs, derives the same
   slug the app uses (`groupName.trim().toLowerCase() + '|' +
   password.trim().toLowerCase()`), and calls `.export(slug)` on each
   candidate's DO instance.

   **Known gap:** a group is only discoverable this way if at least one of its
   members has round-tripped through `POST /api/groups/session` (i.e. loaded
   the app) since that session record was written. A migrated group whose
   members never visit again after migrating leaves no trace in KV and will be
   **silently missing** from this backup — there is currently no way to detect
   or back up such a group. Treat part 2 as best-effort coverage, not a
   guarantee.

See `src/backup.js` (`backupGroups` for part 1, `backupGroupDOs` for part 2).

**How often:** daily, via cron `0 10 * * *` (10:00 UTC). Cron Triggers always
fire in UTC and don't shift for daylight saving, so this lands at ~3am Pacific
during PDT (Mar–Nov) and ~2am Pacific during PST (Nov–Mar) — both low-traffic,
so the DST drift wasn't worth working around.

**Where it lives:** R2 bucket `postandin-backups`, two objects per day:

`backups/groups-YYYY-MM-DD.json` (part 1, KV):
```json
{ "exportedAt": "2026-07-03T10:00:00.000Z", "keys": { "group:abc": "...", "session:xyz": "..." } }
```

`backups/groups-do-YYYY-MM-DD.json` (part 2, DO exports):
```json
{ "exportedAt": "2026-07-03T10:00:00.000Z", "slugCount": 9, "groups": [ { "slug": "cks|captainusa!", "groupName": "CKs", "members": [...], "rsvp": {...} } ] }
```
Each value is the exact raw string stored in KV — no re-encoding, so it can be
written straight back with `wrangler kv key put` / `kv bulk put`.

**Retention:** 30 days, via an R2 lifecycle rule on the `backups/` prefix (set
up once — see below).

**On-demand backup:** force a backup immediately — e.g. right before any
deliberate risky operation — by hitting:
```sh
curl https://postandin-scheduler.<your-subdomain>.workers.dev/backup-now
```
This runs synchronously and returns the R2 path once the backup is written.
`scripts/admin-purge.js` (see repo root) also triggers this automatically
before it will delete anything.

### One-time R2 setup

1. **Enable R2 on the account** — Cloudflare dashboard → R2 → follow the
   one-time enablement flow. There's no wrangler command for this step; it's a
   dashboard-only, one-time account action.
2. **Create the bucket:**
   ```sh
   wrangler r2 bucket create postandin-backups
   ```
3. **Add the 30-day expiry lifecycle rule:**
   ```sh
   wrangler r2 bucket lifecycle add postandin-backups expire-old-backups backups/ --expire-days 30
   ```
   Or in the dashboard: R2 → `postandin-backups` → Settings → Lifecycle Rules
   → Add rule → apply to prefix `backups/` → expire after 30 days.
4. **Deploy** (the R2 binding is already in `wrangler.toml`):
   ```sh
   cd scheduler && wrangler deploy
   ```
5. **Verify the lifecycle rule is active:**
   ```sh
   wrangler r2 bucket lifecycle list postandin-backups
   ```
6. **Test end to end:** hit `/backup-now` (see above) and confirm the object
   shows up: `wrangler r2 object get postandin-backups/backups/groups-<today>.json --file /tmp/check.json --remote`

### Restore procedure (disaster recovery)

Use this after any incident where GROUPS data was lost or corrupted. It's a
full overwrite-by-key restore — keys written *after* the backup was taken and
not present in the backup file are left alone, not deleted.

1. **Get the backup file** (find the date you want in the dashboard, or
   `wrangler r2 object get postandin-backups/backups/ --remote` to browse):
   ```sh
   wrangler r2 object get postandin-backups/backups/groups-2026-07-03.json --file ./restore.json --remote
   ```

2. **Convert it into wrangler's bulk-put format.** The backup is
   `{ exportedAt, keys: { key: value, ... } }`; `wrangler kv bulk put` wants an
   array of `{ key, value }` objects:
   ```sh
   node -e "
   const data = require('./restore.json');
   const bulk = Object.entries(data.keys).map(([key, value]) => ({ key, value }));
   require('fs').writeFileSync('./restore-bulk.json', JSON.stringify(bulk));
   console.log('Restoring', bulk.length, 'keys from backup exported at', data.exportedAt);
   "
   ```
   Optional: to skip restoring the live `schedule:cache` (harmless either way —
   it's regenerated within 30 min), add
   `.filter(([k]) => k !== 'schedule:cache')` before `.map(...)` above.

3. **Find the GROUPS namespace ID** (also in `scheduler/wrangler.toml`, binding
   `GROUPS`):
   ```sh
   wrangler kv namespace list
   ```

4. **Write everything back:**
   ```sh
   wrangler kv bulk put --namespace-id <GROUPS_NAMESPACE_ID> ./restore-bulk.json --remote
   ```

5. **Spot-check** a few keys came back correctly:
   ```sh
   wrangler kv key get "group:<some-slug>" --namespace-id <GROUPS_NAMESPACE_ID> --text --remote
   ```

## Adding a new rink

Edit **`lib/rinks.js`** only — add the new entry with the correct `system` and `config`.
The scheduler picks it up automatically on the next cron run (no wrangler.toml changes
needed unless the system type is entirely new and requires a new scraper).

After updating `lib/rinks.js`:
- Push to GitHub (Pages redeploys with the new rink in the client RINKS config)
- Run `wrangler deploy` from `scheduler/` (scheduler uses the updated RINKS)

## Scraper modules

All scraping logic lives in `lib/scrapers/`:
- `daysmart.js` — DaySmart Recreation (Kraken, Sno-King)
- `rectimes.js` — RecTimes (Olympic View, Lynnwood)
- `kentvalley.js` — Kent Valley (Google Calendar iCal)
- `everett.js` — Everett / Angel of the Winds (Firebase Cloud Function)

Both the scheduler and the Pages Function at `/api/schedule` import from these.

## KV key layout (for reference)

| Key | Written by | Read by | Format |
|---|---|---|---|
| `schedule:cache` | Scheduler (cron) | `/api/schedule` | `{ fetchedAt, data: { [rinkKey]: { ok, sessions } } }` |
| `rsvp:{groupSlug}` | `/api/groups/rsvp` (POST) | `/api/groups/rsvp` (GET) | `{ [sessionKey]: [displayName,...] }` |
| `group:{slug}` | `/api/groups/create`, `join` | `/api/groups/join`, `leave` | group metadata |
| `session:{sessionId}` | `/api/groups/session` | `/api/groups/session` | `{ displayName, groups }` |
