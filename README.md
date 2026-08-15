# Seattle Ice Schedules — Post & In

Aggregates Stick & Puck and Drop-in Hockey sessions across Seattle-area rinks into two live schedule pages backed by the same shared interface.

- **[Stick & Puck](https://postandin.com/stick-and-puck/)**
- **[Drop-in Hockey](https://postandin.com/drop-in-hockey/)**

---

## Rinks

| Rink | City | System | Notes |
|------|------|--------|-------|
| Kraken Community Iceplex | Seattle | DaySmart | Direct API, no proxy needed |
| Sno-King Ice Arena | Renton | DaySmart | Resources 11, 12 (Large + Small Ice) |
| Sno-King Ice Arena | Kirkland | DaySmart | Resource 1 |
| Sno-King Ice Arena | Snoqualmie | DaySmart | Resources 13, 14 (Rink A + B) |
| Olympic View Arena | Mountlake Terrace | RecTimes | Booking link still points to FareHarbor |
| Lynnwood Ice Center | Lynnwood | RecTimes | Includes general and Female Stick & Puck sessions |
| Everett Community Ice Rink | Everett | Custom (Angel of the Winds) | Shared scraper pipeline |
| Kent Valley Ice Centre | Kent | Google Calendar iCal | Shared scraper pipeline |

---

## Groups feature

Users can create a private group so members can see who's attending each session. Group membership is shared across both activity pages: a user joins once and sees the same groups on Stick & Puck and Drop-in Hockey. RSVPs remain activity-specific, and each page's group detail sheet shows signups for the activity currently being viewed rather than combining both schedules into one list.

### Joining mechanic

- **Create**: enter your display name, a group name (e.g. "SJ 16UAA"), and a password (e.g. "Sno-King sucks"). Share the group name + password out-of-band with teammates.
- **Join**: enter your display name plus the group name and password a teammate shared with you.

The combination of group name + password identifies the group — neither needs to be globally unique on its own. The group lookup key is a deterministic slug: `groupName.trim().lower() + "|" + password.trim().lower()`. No random code is generated or stored.

After joining, the group chip in the filter bar shows the group name. Tapping the chip reveals a popover with the group name, the password (for resharing), and a copy button that copies `"Group: [name] / Password: [password]"` to the clipboard.

### RSVP storage

RSVP records live in each group's Durable Object, keyed by session. Stick & Puck keeps the legacy `{rinkKey}|{YYYY-MM-DD}|{HH:MM}` format; Drop-in Hockey appends `|drop-in-hockey`, preventing same-rink/same-time sessions from colliding. Entries more than 24 hours past their session start are pruned on writes.

The former “Nudge your group” control was never wired to an action and has been removed from both schedule pages. Its unused API endpoint remains in place for compatibility but has no user-interface caller.

### Cloudflare bindings

Pages uses the `GROUPS` KV binding for browser-session records and schedule caches, plus the `GROUP_DO` Durable Object binding for group membership and RSVPs. The Durable Object class is hosted by the separately deployed `postandin-group-do` Worker.

---

## Architecture

Both static pages use the modules under `stick-and-puck/modules/` and the shared `stick-and-puck/schedule.css`. Each page declares an explicit `data-activity`; the pure activity configuration maps Stick & Puck to the backward-compatible `/api/schedule` request and Drop-in Hockey to `/api/schedule?activity=drop-in-hockey`.

```
Browser (/stick-and-puck/ or /drop-in-hockey/)
  └─ /api/schedule[?activity=drop-in-hockey]
       └─ activity-specific KV cache written by the scheduler Worker
```

### Serverless functions

Cloudflare Pages Functions in `functions/api/`:

- **`schedule.js`** — reads the selected activity's pre-scraped KV cache and safely falls back to an activity-scoped live scrape on a cache miss
- **`rectimes.js`** and **`everett.js`** — legacy per-rink endpoints retained alongside the shared schedule path

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
| Female/Non-Binary | Sessions whose subtitle matches `female`, `non-binary`, or `women` for the current activity |

## Rink legend and grouping

The legend renders one chip per rink, using city name as the label. Rinks with a `legendKey` field in `RINKS` are hidden from the legend and instead fold into the chip for the rink they reference. Clicking that chip shows sessions from all rinks in the group. Currently `lynnwoodFemale` groups under `lynnwood` so both Lynnwood items appear under a single LYNNWOOD chip.

---

## Local development

### Static pages
```bash
python3 -m http.server
```
This serves both HTML shells and shared assets, but `/api/schedule` requires the Pages development server below.

### With Cloudflare Pages (all rinks)
```bash
npx wrangler pages dev . --compatibility-flag=nodejs_compat
```

---

## Maintenance

Periodically run `node scripts/audit-rinks.js` to check for new session types across all rinks. The audit covers both Stick & Puck and Drop-in Hockey classifications; reviewed source labels belong in `lib/activities.js` and its tests rather than either HTML shell.

---

## Kent Valley iCal notes

Kent Valley's Google Calendar (`kentvalleyicecentre.com@gmail.com`) is fetched as iCal server-side to avoid CORS. Google Calendar pre-expands recurring events into individual VEVENT blocks, so no RRULE handling is needed. Events are filtered to those with `stick` in the summary and a DTSTART that includes a time component (all-day events are skipped). The last good response is cached in the Workers Cache API so transient Google Calendar failures serve stale data instead of an error.
