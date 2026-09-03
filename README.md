# Seattle Ice Schedules — Post & In

Aggregates Stick & Puck, Drop-in Hockey, and Public Skate sessions across
Seattle-area rinks into three live schedule pages backed by one shared client
and activity-specific schedule caches.

- **[Stick & Puck](https://postandin.com/stick-and-puck/)**
- **[Drop-in Hockey](https://postandin.com/drop-in-hockey/)**
- **[Public Skate](https://postandin.com/public-skate/)**

## Documentation map

- `README.md` is the current developer overview and quick-start.
- `AGENTS.md` and `CLAUDE.md` define implementation and review workflow.
- `instructions/postandin-technical-spec.md` is the detailed architecture and
  product handoff; code and configuration remain authoritative.
- `scheduler/README.md` is the scheduler/backup operations runbook.
Update the relevant document in the same change as behavior or configuration.
Operational commands must be verified against the checked-in config and current
CLI before use. Never place secrets or private identifiers in documentation.

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
| Angel Of The Winds Arena | Everett | Custom | One venue record covering the Community Rink and Main Rink sheets |
| Kent Valley Ice Centre | Kent | Google Calendar iCal | Shared scraper pipeline |

---

## Groups feature

Users can create a private group so members can see who's attending each
session. Membership is shared across all three schedules; RSVPs remain
activity-specific.

### Joining mechanic

- **Create**: enter your display name, a group name, and a shared password. Share
  the group name + password out-of-band with teammates.
- **Join**: enter your display name plus the group name and password a teammate shared with you.

The combination of group name + password identifies the group — neither needs to be globally unique on its own. The group lookup key is a deterministic slug: `groupName.trim().lower() + "|" + password.trim().lower()`. No random code is generated or stored.

After joining, the group chip in the filter bar shows the group name. Tapping
the chip opens a bottom sheet with the shared password and upcoming sessions
where group members have RSVP'd.

### RSVP storage

RSVP records live in each group's Durable Object, keyed by session. Stick & Puck keeps the legacy `{rinkKey}|{YYYY-MM-DD}|{HH:MM}` format; Drop-in Hockey appends `|drop-in-hockey`, and Public Skate appends `|public-skate`, preventing same-rink/same-time sessions from colliding. Entries more than 24 hours past their session start are pruned on writes.

The former “Nudge your group” control was never wired to an action and has been
removed from the schedule pages. Its unused API endpoint remains for
compatibility but has no user-interface caller.

### Cloudflare bindings

Pages uses the `GROUPS` KV binding for browser-session records and schedule caches, plus the `GROUP_DO` Durable Object binding for group membership and RSVPs. The Durable Object class is hosted by the separately deployed `postandin-group-do` Worker.

---

## Architecture

All three static schedule pages use the modules under
`stick-and-puck/modules/` and the shared `stick-and-puck/schedule.css`. Each
declares `data-activity`; `activity-config.js` maps it to the appropriate API
request and page capabilities. Public Skate enables Groups and duration while
keeping hockey-specific detail badges disabled.

```
Browser (one of the three schedule pages)
  └─ /api/schedule[?activity=drop-in-hockey|public-skate]
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
| Today | Sessions starting today |
| Tomorrow | Sessions starting tomorrow |
| This Week | Sessions starting within 7 days |
| Female/Non-Binary | Hockey sessions with normalized female/women/non-binary audience metadata; reviewed title/source-label matching supports older cached records |

Public Skate exposes only All, Today, Tomorrow, and This Week; the hockey pages
also expose Female/Non-Binary. Every schedule shows time, place, duration, RSVP
attendance, and calendar actions. The site never presents source-provided price,
reservation, remaining-spots, availability, or sold-out information; users
follow the session row to the source booking page for those details. Public
Skate also omits hockey program subtitles.

## Rink legend and grouping

The legend renders one chip per rink, using city name as the label. The client
also supports an optional `legendKey` for grouping future rink entries, though
the current `RINKS` configuration does not use it.

---

## Local development

### Static pages
```bash
python3 -m http.server
```
This serves the HTML shells and shared assets, but `/api/schedule` requires the
Pages development server below.

### With Cloudflare Pages (all rinks)
```bash
npx wrangler pages dev .
```
The Pages compatibility date is managed outside this repository. If runtime
parity matters for the change being tested, verify the production Pages date in
Cloudflare and pass that value with `--compatibility-date`.

### Verification

```bash
node --test tests/*.test.mjs
node scripts/audit-rinks.js       # live, read-only source classification audit
node scripts/health-check.js      # live, read-only production smoke test
node scripts/check-nwahl-travel.mjs # live, read-only NWAHL travel comparison
git diff --check
```

Run `node --check` on changed JavaScript files. Frontend work also requires
desktop/mobile browser checks and console inspection; routing work requires
checking metadata, `robots.txt`, `sitemap.xml`, `404.html`, and a real unknown
path together.

## Deployment boundaries

- Pushing `main` deploys the Cloudflare Pages site and Pages Functions.
- `group-do/` is a separate Worker and requires `wrangler deploy` from that
  directory when its code/config changes.
- `scheduler/` is a separate Worker and requires `wrangler deploy` from that
  directory when its code/config or imported `lib/` runtime changes.
- Never infer a Worker deployment from a Git push; verify each release path.

---

## Maintenance

Run `node scripts/audit-rinks.js` periodically to check all three activities
for new source labels. Reviewed production classifications belong in
`lib/activities.js`; reviewed audit-only exclusions belong in the audit's
known patterns. Both require tests.

---

## Kent Valley iCal notes

Kent Valley uses separate iCal feeds for Stick & Puck and Public Skate. The
scraper parses local/UTC timestamps, Pacific-local timestamps, RRULE weekly
recurrence, EXDATEs, cancellations, overrides, and orphaned overrides within a
30-day horizon. Feed failures are isolated by activity; the scheduler carries
forward recent last-known-good rink/activity data for up to 24 hours.
