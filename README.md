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

## Gear Exchange (in development)

Local seller sessions, reload recovery, an HTTPS browser check and ownership-checked management are documented in
[instructions/gear-management.md](instructions/gear-management.md).

Local verified mailbox transfers are described in [instructions/gear-email-change.md](instructions/gear-email-change.md).

Local D1/workerd results and the repeatable harness are in
[instructions/gear-d1-validation.md](instructions/gear-d1-validation.md).

Local buyer contact and its temporary test inbox are documented in
[instructions/gear-contact.md](instructions/gear-contact.md).

Local owner review supports authenticated dismiss/remove/restore and persistent
action history; see [instructions/gear-owner-moderation.md](instructions/gear-owner-moderation.md).

Local listing reports use a bounded inspection queue; see
[instructions/gear-reports.md](instructions/gear-reports.md).

Persistent local management photos are documented in
[instructions/gear-photos.md](instructions/gear-photos.md).

The source-only production foundation adds immutable adult-acknowledgement
evidence and a D1 metadata adapter for private Cloudflare Images. It provisions
nothing and adds no upload, authentication or deployed write route; see
[instructions/gear-storage.md](instructions/gear-storage.md).

The source-only production owner boundary validates Cloudflare Access JWTs with
native Web Crypto and an environment-provided exact allowlist. Nothing is
provisioned or deployed; see [instructions/gear-access.md](instructions/gear-access.md).

The source-only production moderation foundation adds constrained D1 tables,
an Access-authenticated open-report queue and same-origin dismiss/remove/restore
actions with transactional history. It is not configured or deployed; see
[instructions/gear-production-moderation.md](instructions/gear-production-moderation.md).

The source-only public report route requires exact-origin JSON, server-validated
Turnstile and a currently public listing before atomically inserting the bounded
report fields. Its widget, secret and edge rate-limit rule are not configured;
see [instructions/gear-production-reports.md](instructions/gear-production-reports.md).

The source-only production seller-deletion path adds an active recovery marker,
minimal purge ledger and authenticated delete/recover transaction, and blocks
owner restore while the active marker exists; see
[instructions/gear-production-deletions.md](instructions/gear-production-deletions.md).

The source-only production seller-access boundary adds same-origin Pages routes
for generic recovery requests, explicit one-use link confirmation, reload
recovery, logout, signed owner-listing reads, and CSRF-protected listing edits and
status changes. A Resend adapter is tested with mock delivery only; no API key,
real mail or edge rate limit is configured. The browser UI now connects these
routes only on the exact production origin, while deployment and provider
configuration remain separate launch work. See
[instructions/gear-production-management.md](instructions/gear-production-management.md).

The source-only production posting flow validates the full listing and a
dedicated `gear-post` Turnstile response before creating an unverified D1 draft.
A random draft ID permits at most five verification emails with a one-minute
cooldown; the Resend adapter
sends a 30-minute fragment credential only to the stored address, and a separate
explicit POST publishes the listing without creating a management session. The
exact-origin browser loads Turnstile only when a public site key is configured,
erases verification fragments before network work, and keeps confirmation usable
when new posting is disabled. The site key, secret, D1 binding, Resend key and
required edge rate limits are not configured or deployed; see
[instructions/gear-production-verification.md](instructions/gear-production-verification.md).

The source-only production maintenance package adds an idempotent D1 cleanup
core, durable hosted-photo deletion outbox, daily scheduled Worker entry point,
abandoned-quarantine and provider-orphan reconciliation, one-minute retry, and
failure/recovery-only Resend alerts. Its deploy config is
an inert example with no resource IDs or secrets; nothing is provisioned or
deployed. See
[instructions/gear-production-maintenance.md](instructions/gear-production-maintenance.md).

The source-only production photo foundation includes authenticated Pages routes
that reserve ten-minute private quarantine uploads through a dedicated Images
service Worker, then claim, sanitize and atomically attach only the verified
still WebP. Provider/D1 failures are compensated immediately or through the
durable deletion outbox when D1 remains writable; unresolved provider commits
are found by the bounded 24-hour-grace reconciliation sweep. Authenticated
source-only routes also remove and reorder attached metadata with exact snapshot
and ownership checks; removal queues remote deletion atomically. The source-only
public listing route now replaces private photo references with ten-minute
Cloudflare Images signed URLs for one configured variant. Upload creation has an
exact 60-per-current-seller UTC-day D1 budget; email transfer starts a fresh
target-seller budget. A separate 12-per-minute source-IP edge rule remains a
required launch configuration, and its desired one-minute period and ten-minute
block require at least Cloudflare Pro under the current plan table. No service
binding, secret, resource, edge rule or route is deployed. The exact-origin
management UI source performs direct upload, finalize, removal and reorder; see
[instructions/gear-production-photos.md](instructions/gear-production-photos.md).

An opt-in connected HTTPS preview is documented in
[instructions/gear-connected-preview.md](instructions/gear-connected-preview.md).

**Continuing this feature? Start with the [resume handoff](instructions/gear-exchange-plan.md#resume-here).**

Local draft storage, validation, per-listing verification and duplicate checks
are implemented separately from the preview;
see [local storage instructions](instructions/gear-storage.md). A source-only
`GET /api/gear/listings` Pages Function now exercises the public D1 projection,
and the exact production-origin Gear browser source now uses that response for
browse and detail instead of sample rows. Responses are size- and shape-checked,
signed photos are restricted to Cloudflare Images delivery, and an initial
failure leaves the public list empty with a generic notice and retry action.
Later refresh failures retain the last validated listing snapshot. Expired image
signatures refresh in the background without changing the selected photo. No
remote binding, database, API deployment or other cloud resource exists. The separate owner-only
`GET /api/gear/admin/reports` route reads the proposed moderation queue only
after Access verification; `POST /api/gear/admin/actions` applies reviewed owner
actions through transactional D1 batches. Run the focused route and storage tests
with `node --test tests/gearPagesListings.test.mjs tests/gearPagesModeration.test.mjs tests/gearPagesModerationActions.test.mjs tests/gearPagesReportSubmission.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs`.

A source-only production buyer-contact boundary now adds durable request
idempotency, hashed ten-minute abuse accounting, 24-hour private delivery copies,
the dedicated `gear-contact` Turnstile action and a bounded plain-text Resend
adapter. The production button remains disabled and no mail/service configuration
exists; the route independently requires `GEAR_CONTACT_ENABLED=true`. See
[production contact instructions](instructions/gear-production-contact.md).

Shared field options and search logic are in `lib/gear-exchange.mjs`.
The [implementation plan](instructions/gear-exchange-plan.md) records approved
product decisions, review findings and remaining launch requirements.
An unlinked, noindex `/gear/` development preview exercises the screens with in-memory sample data. There is no deployed backend yet. Run its focused checks with
`node --test tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs`.

Preview screens live in `gear/index.html`, `gear/gear.css`, and `gear/gear.mjs`.
Under ordinary static hosting, listings, management access, verification and
contact actions are simulated; inputs and photos reset on reload. The opt-in
local server persists listings and management photos (see [photo documentation](instructions/gear-photos.md)).
The static public sample dataset is separate from seller drafts. Production
provider configuration, remote migrations, staging checks and deployment remain
unimplemented. The separate storage query already filters expiry on reads.


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
node scripts/team-schedule-monitor.mjs # live three-way NWAHL/SportsEngine/travel-page check
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
- `gear-maintenance/` is a separate scheduled Worker and requires its own
  completed config, reviewed migration/bindings and explicit `wrangler deploy`.
- `gear-images/` is a separate service-binding-only Worker and requires its own
  reviewed Images binding, isolated staging check and explicit `wrangler deploy`.
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

Local seller deletion now supports a 30-day recovery window, explicit offline
cleanup and tested SQLite record/photo snapshot restoration. See
[Gear lifecycle](instructions/gear-lifecycle.md) for retention, commands and limitations.
Production maintenance deployment and remote disaster recovery remain launch gates.

Local Gear cleanup now runs on server startup and daily while listening, with
one-minute failure retries. The approved short retention schedule and optional
snapshot-pruning directory are documented in `instructions/gear-lifecycle.md`.
Production scheduling and external failure alerts now have source only;
resource provisioning, staging verification and deployment remain launch gates.
