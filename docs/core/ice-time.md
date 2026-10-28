# Ice Time

Status: **current core product**.

Ice Time aggregates Seattle-area Stick & Puck, Drop-in Hockey, and Public Skate
sessions. The three pages share one browser client and activity-specific schedule
caches.

## Public pages

- `/stick-and-puck/`
- `/drop-in-hockey/`
- `/public-skate/`

Each HTML shell declares its activity with `data-activity` and loads the shared
stylesheet and modules under `stick-and-puck/`. `activity-config.js` maps the
page to its API query and controls activity-specific capabilities.

Public Skate enables Groups, RSVPs, duration, and calendar actions while
omitting hockey program subtitles. Hockey pages also expose the
Female/Non-Binary filter. The site deliberately does not present source-provided
price, live availability, remaining-spots, or sold-out claims. Explicit
title-based access restrictions in reviewed source formats are normalized into
session subtitles. RecTimes Stick & Puck titles currently identify Female-only
and reserved sessions, including SJHA reservations.

## Filters and session actions

All three schedules provide **All**, **Today**, **Tomorrow**, and **This Week**
filters plus independent rink selection. Stick & Puck and Drop-in Hockey also
provide **Female/Non-Binary**, which uses normalized audience data with a
bounded compatibility fallback for older cache entries.

Every session retains its source or booking link when one exists. Sessions with
exact start and end times also provide a keyboard-accessible, 44px **Add to
calendar** action that generates an `.ics` file in the browser. If the source
does not provide an exact end, the calendar action is omitted rather than
inventing a duration. Group members receive a keyboard-accessible, 44px **RSVP**
action beside it; both actions stop the surrounding source-link navigation.

## Data flow

```text
Rink sources
  -> scheduler Worker every 30 minutes
  -> activity-specific KV cache
  -> GET /api/schedule?activity=...
  -> shared browser renderer
```

`/api/schedule` defaults to Stick & Puck and accepts
`activity=drop-in-hockey` or `activity=public-skate`. A cache miss can fall back
to an activity-scoped live scrape.

The shared source configuration and orchestration live in:

- `lib/activities.js`
- `lib/rinks.js`
- `lib/scrapeAll.js`
- `lib/scrapers/`

The scheduler imports these files directly. A change to them can require both a
Pages release and a separate scheduler deployment.

## Rink sources

| Venue | System |
|---|---|
| Kraken Community Iceplex | DaySmart |
| Sno-King Renton, Kirkland, and Snoqualmie | DaySmart |
| Olympic View Arena | RecTimes |
| Lynnwood Ice Center | RecTimes |
| Angel Of The Winds Arena | Custom Everett source |
| Kent Valley Ice Centre | Google Calendar iCal |

The source list and exact identifiers in `lib/rinks.js` are authoritative.

Kent Valley has separate Google Calendar feeds for Stick & Puck and Public
Skate. Its parser handles UTC and Pacific-local times, weekly recurrence rules,
exclusions, cancellations, and recurrence overrides within a 30-day horizon.
Feed failures are isolated by activity.

For every source, the scheduler can carry forward a successful rink/activity
result for up to 24 hours when that source later fails. Older or malformed prior
results are rejected, and an all-failed scrape leaves the existing activity
cache untouched.

## Groups and RSVPs

Membership is shared across all three schedules. RSVP records are stored in the
group's Durable Object and qualified by activity to prevent same-place,
same-time sessions from colliding. Pages uses KV for browser-session records and
schedule caches, and the separately deployed `group-do` Worker hosts the
Durable Object class.

Client-supplied `memberId` values must be validated against group membership
before any write.

### Identity and sessions

There are no user accounts. A group is identified by the normalized group name
and password joined as `group-name|password`; there is no random group code.
The client stores joined-group details, including the shared password and member
ID, in `postandin_groups` local storage. Treat browser storage as private device
state rather than an authorization boundary.

The `sp_sid` secure, HttpOnly cookie identifies a server-side session stored in
the `GROUPS` KV namespace so membership can survive loss of local storage. The
non-HttpOnly `sp_has_session=1` gate cookie lets visitors without a session skip
the KV read. Membership and display name are shared across all three schedules.

### RSVP keys and retention

Stick & Puck retains the legacy RSVP key shape
`rink|YYYY-MM-DD|HH:MM[|sheet]`. Drop-in Hockey and Public Skate append their
activity ID so simultaneous sessions do not collide. The Durable Object prunes
RSVP entries more than 24 hours past the parsed session start on each RSVP
write.

The legacy `GET /api/groups/nudge` endpoint still returns prefilled Stick & Puck
share text for compatibility. No current user interface calls it.

## Module dependency boundary

The modules under `stick-and-puck/modules/` follow this dependency direction:

```text
activity-config.js, calendar.js, state.js, utils.js  (local leaves)
  -> storage.js
  -> rsvp.js
  -> schedule.js
  -> groups-ui.js
  -> main.js
```

More specifically, `storage.js` imports only leaves; `rsvp.js` imports leaves
and storage; `schedule.js` imports leaves, storage, and RSVP; `groups-ui.js`
imports leaves, storage, RSVP, and schedule; and `main.js` imports the feature
modules and starts the application. In particular, `rsvp.js` must not import
back from `schedule.js`. Put shared constants and presentation fragments, such
as `GOING_PERSON_SVG`, in a lower-level module rather than introducing a cycle.
Inspect the actual imports before changing this graph.

## Verification

```bash
node --test tests/*.test.mjs
node scripts/audit-rinks.js
node scripts/health-check.js
```

The audit and health check contact live public sources. For operations, cache
keys, deployment, backup behavior, and known restore limitations, see
[Ice Time and Groups operations](../operations/ice-time-and-groups.md).
