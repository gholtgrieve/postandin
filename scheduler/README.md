# postandin-scheduler

A standalone Cloudflare Worker that scrapes all rink schedules on a 30-minute cron
and writes the result to KV.  The Pages site's `/api/schedule` endpoint reads from
this cache instead of scraping on every visitor request.

## How the two pieces fit together

| Piece | Deploy path | Trigger |
|---|---|---|
| **Pages site** (`functions/`, `stick-and-puck/`, etc.) | Auto-deploys from GitHub `main` via Cloudflare Pages | Git push |
| **Scheduler Worker** (`scheduler/`) | **Requires a manual `wrangler deploy`** — not deployed by Pages | Cron (every 30 min) |

**Pushing to GitHub does NOT update the scheduler.** Run `wrangler deploy` from
`scheduler/` each time you change scraping logic.

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
