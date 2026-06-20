# Seattle Stick & Puck — Post & In

Aggregates open stick & puck ice times across Seattle-area rinks into a single live page.

Live at **[postandin.com/stick-and-puck](https://postandin.com/stick-and-puck/)**

---

## Rinks

| Rink | City | System | Notes |
|------|------|--------|-------|
| Kraken Community Iceplex | Seattle | DaySmart | Direct API, no proxy needed |
| Sno-King Ice Arena | Renton | DaySmart | Resources 11, 12 (Large + Small Ice) |
| Sno-King Ice Arena | Kirkland | DaySmart | Resource 1 |
| Sno-King Ice Arena | Snoqualmie | DaySmart | Resources 13, 14 (Rink A + B) |
| Olympic View Arena | Mountlake Terrace | FareHarbor | itemPk 313860, proxied via `/api/fareharbor` |
| Lynnwood Ice Center | Lynnwood | FareHarbor | itemPk 245296 (general), 737473 (Female Stick & Puck), proxied via `/api/fareharbor` |
| Everett Community Ice Rink | Everett | Custom (Angel of the Winds) | Proxied via `/api/everett` |
| Kent Valley Ice Centre | Kent | Google Calendar iCal | Proxied via `/api/kentvalley` |

---

## Groups feature

Users can create a private group so members can see who's attending each session.

### Joining mechanic

- **Create**: enter your display name, a group name (e.g. "SJ 16UAA"), and a password (e.g. "Sno-King sucks"). Share the group name + password out-of-band with teammates.
- **Join**: enter your display name plus the group name and password a teammate shared with you.

The combination of group name + password identifies the group — neither needs to be globally unique on its own. The KV lookup key is a deterministic slug: `groupName.trim().lower() + "|" + password.trim().lower()`. No random code is generated or stored.

After joining, the group chip in the filter bar shows the group name. Tapping the chip reveals a popover with the group name, the password (for resharing), and a copy button that copies `"Group: [name] / Password: [password]"` to the clipboard.

### RSVP storage

RSVP records are stored in Cloudflare KV under `rsvp:{groupSlug}:{sessionKey}`. Each record expires 24 hours after the session start time (parsed from the session key, format `{rinkKey}|{YYYY-MM-DD}|{HH:MM}`), so stale RSVPs clean up automatically without any cron job.

### KV namespace

Requires a Cloudflare KV namespace bound as `GROUPS` in the Pages dashboard:
> Settings → Functions → KV namespace bindings → Variable name: `GROUPS`

---

## Architecture

All session data is fetched client-side from `stick-and-puck/index.html`. Sources that require a CORS proxy are routed through serverless functions.

```
Browser (stick-and-puck/index.html)
  ├─ DaySmart API (Kraken, Sno-King ×3)   direct fetch — no CORS issue
  ├─ FareHarbor API (OVA, Lynnwood)        direct fetch — no CORS issue
  ├─ /api/fareharbor  ────────────────┐
  ├─ /api/everett     ────────────────┤
  └─ /api/kentvalley  ────────────────┴── serverless functions (see below)
```

### Serverless functions

Cloudflare Pages Functions in `functions/api/`:

- **`fareharbor.js`** — proxies FareHarbor calendar API to avoid CORS; used for both Lynnwood items (general + female)
- **`everett.js`** — proxies Angel of the Winds schedule API
- **`kentvalley.js`** — fetches and parses Kent Valley's public Google Calendar iCal feed; caches last good response in the Workers Cache API so transient Google Calendar failures serve stale data instead of an error

---

## UI filters

The controls bar exposes these filters (mutually exclusive; the rink legend chips are a separate independent multi-select):

| Filter | Shows |
|--------|-------|
| All | Every upcoming session |
| Available | Sessions not marked sold out |
| Today | Sessions starting today |
| Tomorrow | Sessions starting tomorrow |
| This Week | Sessions starting within 7 days |
| Female/Non-Binary | Sessions whose subtitle matches `female`, `non-binary`, or `women` — currently Lynnwood Female Stick & Puck and any DaySmart sessions with a qualifying league name |

## Rink legend and grouping

The legend renders one chip per rink, using city name as the label. Rinks with a `legendKey` field in `RINKS` are hidden from the legend and instead fold into the chip for the rink they reference. Clicking that chip shows sessions from all rinks in the group. Currently `lynnwoodFemale` groups under `lynnwood` so both Lynnwood items appear under a single LYNNWOOD chip.

---

## Local development

### Static only (DaySmart + FareHarbor rinks)
```bash
open stick-and-puck/index.html
```
Kraken, Sno-King, OVA, and Lynnwood fetch live. Everett and Kent Valley will error without their proxy functions running.

### With Cloudflare Pages (all rinks)
```bash
npx wrangler pages dev . --compatibility-flag=nodejs_compat
```

---

## Finding a FareHarbor item PK

From the browser console on the page:
```js
await window.discoverLynnwoodPKs()
// Returns a table of all Lynnwood FareHarbor items
// Once you have the PK:
window.setLynnwoodPK(123456)
loadData()
```

Then update `itemPk` in the `RINKS` config in `stick-and-puck/index.html`.

---

## Maintenance

Periodically run `node scripts/audit-rinks.js` to check for new session types across all rinks. The script scans FareHarbor item lists, DaySmart league names, and iCal summaries for anything hockey-related that isn't already in `KNOWN` (the allowlist at the top of the script). When you add a new session to `stick-and-puck/index.html`, update `KNOWN` in the audit script to keep it in sync.

---

## Kent Valley iCal notes

Kent Valley's Google Calendar (`kentvalleyicecentre.com@gmail.com`) is fetched as iCal server-side to avoid CORS. Google Calendar pre-expands recurring events into individual VEVENT blocks, so no RRULE handling is needed. Events are filtered to those with `stick` in the summary and a DTSTART that includes a time component (all-day events are skipped). The last good response is cached in the Workers Cache API so transient Google Calendar failures serve stale data instead of an error.
