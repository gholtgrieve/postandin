# Post & In — Technical Specification & Handoff Document

> **This document is reference and background material, not a live source of
> truth.** It describes the architecture and conventions as of the last
> resync, but the codebase is the only authority on current behavior. Before
> making, or suggesting, any change — always check the actual files in the
> repository first (via GitHub, a local checkout, or by pulling the repo)
> rather than relying on what's written here. Treat any mismatch you find
> between this document and the real code as the document being wrong, and
> flag it rather than assuming the document is current.
>
> **Mandatory pre-commit documentation check.** Before every commit, compare
> the behavior, architecture, routes, data sources, labels, cache
> keys, bindings, deployment requirements, and operational workflow against
> this document. Update this document in the same commit whenever the change
> affects any of those facts. Do not create the commit until this check is
> complete. If no documentation update is required, explicitly record that
> conclusion in the task handoff after the commit.
>
> **Tracked in git as of 2026-07-22.** This file used to live only in the
> gitignored `instructions/` directory. It is now version-controlled at
> `instructions/postandin-technical-spec.md` and travels with the code, so it
> can be updated in the same commit as the change it describes — which is the
> intended workflow. `.gitignore` ignores everything else under
> `instructions/` (drafts, audit reports, backlog notes) via an explicit
> negation; adding a file there does *not* track it.
>
> **This repo is public.** Anything written here is published to
> github.com/gholtgrieve/postandin the moment it is committed, and git history
> is permanent. Never write credentials, base IDs, tokens, or private
> individuals' details into this file.

## Overview

Post & In (postandin.com) is a static site with serverless API functions built
for the Seattle hockey community. There is no build step, framework, bundler,
or root package.json. Everything is vanilla HTML, CSS, and JavaScript.
Server-side logic lives in Cloudflare Pages Functions plus two separately
deployed Workers: the schedule/backup Worker and the Groups Durable Object
Worker. The design philosophy is deliberate minimalism—add infrastructure only
when the simplest approach breaks down.

The site owner is actively developing this into a mission-driven community platform. New features are scoped and designed conversationally before being handed to Codex for implementation. Do not introduce complexity that wasn't explicitly requested.

---

## Hosting & Deployment

The repository proves application code and the two Worker configurations.
Pages plan level, custom-domain/DNS state, dashboard bindings and variables,
the GitHub auto-deploy connection, and R2 lifecycle rules are externally
managed assumptions; verify them in Cloudflare before operational changes.

- Platform: Cloudflare Pages, $5/month Workers Paid plan
- Deployment: Auto-deploys from the main branch of github.com/gholtgrieve/postandin
- Build step: None. Cloudflare serves files as-is.
- Custom domain: postandin.com, DNS managed in Cloudflare
- The paid Workers plan covers higher KV read/write limits and increased function invocations beyond the free tier

---

## GitHub Repository

- URL: github.com/gholtgrieve/postandin
- Branch strategy: implement and review on short-lived `codex/<task>` branches,
  then fast-forward merge approved work into `main`.
- Pushing `main` triggers a Cloudflare Pages deployment. There is no persistent
  staging branch or CI/CD pipeline beyond Cloudflare's auto-deploy.

### Browsing code on GitHub
- Navigate to github.com/gholtgrieve/postandin to see the full file tree
- Click any file to view its contents
- The commit history shows what changed and when — useful for understanding recent work

### Making changes
- All file edits are done locally via Codex, never directly on GitHub
- The one canonical local repo is `~/Dropbox/Documents/postandin`. This short
  path is a symlink to Dropbox's managed team folder; always open and refer to
  the repository through the short path.
- Never implement, review, or preserve Post & In changes in a dated
  `~/Documents/Codex/...` task directory or another clone. At the start of every
  Codex or Claude session, verify `pwd`, `git rev-parse --show-toplevel`, branch,
  and `git status --short`; stop on a path mismatch before editing.
- Dropbox sync is active — the local repo is also backed up to Dropbox cloud storage
- Codex implements on a short-lived `codex/<task>` branch
- The owner runs Claude Code in the canonical repo and returns its report to
  Codex. Codex supplies a complete review prompt but does not invoke Claude
  directly unless the owner explicitly requests that external action.

### Standard git workflow
```bash
cd ~/Dropbox/Documents/postandin
git switch main && git pull --ff-only
git switch -c codex/brief-task-name
# open the repository in Codex and ask it to implement + verify the change
# Codex gives the owner a complete Claude review prompt. The owner then runs:
claude
# "Review git diff main...HEAD and any uncommitted changes. Follow CLAUDE.md.
# Do not edit files."
git add -A
# Required before every commit: reconcile this technical spec with the change.
git commit -m "Description of what changed"
git switch main
git merge --ff-only codex/brief-task-name
git push origin main
# Cloudflare deploys automatically in ~60 seconds
```

If `git merge --ff-only` fails because `main` advanced after the task branch was
created, stop rather than forcing the merge. Switch back to the task branch,
rebase it onto the updated `main`, rerun the relevant checks and Claude review,
then retry the fast-forward merge.

### Verifying a deployment
- Go to dash.cloudflare.com → Workers & Pages → postandin → Deployments tab
- Latest deployment should show Success
- Or curl the relevant endpoint and confirm it returns expected data

### Rolling back a bad deployment
- Go to Cloudflare Pages → Deployments tab
- Find the last good deployment → click ... → Rollback to this deployment
- Then fix the issue locally and push again

---

## Codex Build / Claude Code Review Workflow

Codex is the primary tool for making changes to the codebase. Claude Code is an
independent reviewer. Neither tool makes strategic decisions about what to
build, UX, or copy — those are scoped with the owner first.

Use the **Standard git workflow** above as the authoritative command sequence
for creating the task branch, committing, merging with `--ff-only`, and pushing
`main`. The guidance below explains the roles within that sequence.

### How to use Codex effectively
- Write a detailed prompt describing exactly what to build before opening Codex
- Include: which files to touch, what the output should look like, any design system constraints
- Open Codex from `~/Dropbox/Documents/postandin`. If Codex reports a path under
  `~/Documents/Codex/` or another clone, stop and reopen the canonical repo
  before allowing any edits.
- Codex reads `AGENTS.md`, inspects the repository, makes the change, and runs relevant checks
- Stop before commit, push, merge, or deploy unless explicitly requested
- Ask Codex for a concise handoff containing changed files, checks, risks, a
  suggested commit message, and a complete copyable Claude review prompt.

### How to use Claude Code for review
```bash
cd ~/Dropbox/Documents/postandin && claude
```
- The owner runs this command; Codex does not launch Claude during the normal
  review handoff.
- Prompt: `Review git diff main...HEAD and any uncommitted changes. Follow CLAUDE.md. Do not edit files.`
- Claude Code should lead with concrete findings ordered by severity
- The owner sends Claude's complete report back to Codex to investigate and fix
- Ask Claude Code to re-review after fixes
- Merge to `main` only after Claude reports `ready to merge` and you understand the checks that ran

### What Codex is used for
- Creating and editing HTML, CSS, JS files
- Creating and editing Cloudflare Functions
- Running curl commands to test API endpoints
- Running the audit script (`node scripts/audit-rinks.js`)
- Preparing curl commands or scripts for Airtable data operations; the owner
  supplies credentials outside the tool and runs authenticated commands

### What Codex and Claude Code are NOT used for
- Strategic decisions about what to build
- UX and design decisions
- Copy and content decisions
- Accessing the Cloudflare dashboard
- Handling secrets in prompts or tracked files

---

## Environment Variables & Secrets

Credentials must be stored in Cloudflare Pages rather than the codebase. The
repository shows which environment variables the code requires, but cannot
prove their current presence or dashboard storage type.

### To view or update secrets
1. Go to dash.cloudflare.com
2. Workers & Pages → postandin → Settings → Environment Variables
3. Secrets show as "Value encrypted" — you cannot retrieve them after saving
4. To rotate a secret: create a new value in the external service, add it here, redeploy

### Required environment variables
| Variable | Description |
|---|---|
| AIRTABLE_API_KEY | Personal Access Token from airtable.com/create/tokens. Required application scope: `data.records:read` for the PostAndIn base. The checked-in code performs no Airtable writes; do not grant write scope unless a separately reviewed workflow requires it. |
| AIRTABLE_BASE_ID | The PostAndIn base ID. Read the live value from the Cloudflare dashboard (Settings → Environment Variables) or the Airtable API docs for that base — deliberately not written down here, see below. |
| COACH_INTAKE_FORM_URL | The published Airtable coach-intake form URL. Stored in Cloudflare rather than the public repository because it contains Airtable identifiers. |

> **Why the base ID isn't printed here.** This document became a tracked file in
> the **public** repo on 2026-07-22. The base ID was previously written out in
> full in this table and in the Airtable section below. It isn't a credential on
> its own — an attacker still needs `AIRTABLE_API_KEY` — but it's a non-public
> identifier that was listed under "Current secrets", and once committed to a
> public repo it's in the git history permanently. Redacted when the file was
> first tracked, so it never entered public history. Don't paste it back in.

Never paste secrets into Codex, Claude Code, documents, chat, tracked files, or
command output. When an authenticated manual operation is necessary, the owner
supplies the credential outside the tool and runs the prepared command.

### KV, R2, and Durable Object bindings
Unlike secrets, these aren't set via `wrangler.toml` for the Pages project —
Cloudflare Pages doesn't support Durable Object or KV bindings in a config
file. They must be added by hand in the dashboard:
&nbsp;&nbsp;Settings → Functions → KV namespace bindings / Durable Object bindings

| Binding | Type | Points to |
|---|---|---|
| GROUPS | KV namespace | Shared namespace also used by `scheduler` (as both GROUPS and SCHEDULE) and `group-do` (for one-time legacy migration reads) |
| GROUP_DO | Durable Object | `GroupDO` class in the separate `postandin-group-do` Worker |

The `group-do` and `scheduler` Workers *do* configure their own bindings via
`wrangler.toml` (they're plain Workers, not Pages) — see each directory's
`wrangler.toml` for the exact binding names, KV namespace ID, and R2 bucket.

---

## File Structure

```
/                          → root index.html (homepage — publicly launched, indexable)
/404.html                  → Branded 404 page (added 2026-07-22). Its presence is what
                              disables Cloudflare Pages' implicit SPA fallback — see
                              Search Visibility & Routing below. Links to Home, all
                              schedule activities, and Coaches.
/stick-and-puck/           → Stick & Puck schedule — primary feature. `index.html`
                              contains no inline JS or CSS: it links the shared stylesheet
                              and a single `<script type="module" src="/stick-and-puck/
                              modules/main.js">` entry point.
/drop-in-hockey/           → index.html (Drop-in Hockey schedule). This is a separate
                              static HTML shell so normal-link activity navigation resets
                              one-shot module state. It deliberately carries the same IDs
                              and complete Groups modal/sheet DOM as Stick & Puck.
                              The homepage Ice Time card mentions all three activities
                              while continuing to link to `/stick-and-puck/` by default.
/public-skate/             → index.html (Public Skate schedule). Uses the same shared
                              schedule shell and normal-link activity switch, but has
                              Groups/RSVPs and duration enabled, while hockey program
                              subtitles remain disabled.
                              All three shells link to the shared stylesheet at
                              `/stick-and-puck/schedule.css` and declare their activity
                              explicitly with `<body data-activity="...">`.
/stick-and-puck/schedule.css → Shared schedule and Groups styling used by all activity
                              pages. Do not duplicate this CSS into either HTML shell.
/stick-and-puck/modules/
    activity-config.js      → Pure activity-to-API configuration. Missing activity keeps
                              the legacy Stick & Puck default; unsupported explicit values
                              fail rather than silently showing the wrong schedule. It
                              also owns page-level Groups, duration, and session-subtitle
                              settings.
    utils.js                → Pure helpers: escapeHtml, safeUrl, safeColor,
                              fmtTime/fmtDuration/dayKey/fmtDayLabel, mkSessionKey,
                              getGroupSlug, GOING_PERSON_SVG. No app-state deps.
    storage.js               → localStorage + server-session layer: GROUPS_ENABLED
                              flag, GROUP_COLORS palette, migrateStorage,
                              getGroups/setGroups, getDisplayName/setDisplayName,
                              syncSession, initSession, ensureGroupColors.
    state.js                 → Shared mutable app state (allData, activeFilter,
                              selectedRinks, sessionMap, rsvpCache, sheetSession,
                              activeGroupSheet). Reassigned values (allData,
                              activeFilter, sheetSession, activeGroupSheet) are
                              exported alongside a setter function, since an ES
                              import binding can't be reassigned from outside the
                              module that declared it — read sites just import the
                              value directly (live binding), only writers use the
                              setter. Values that are only ever mutated in place
                              (selectedRinks, sessionMap, rsvpCache) are exported
                              as plain consts.
    rsvp.js                  → RSVP/"going" subsystem: allUniqueGoing,
                              updateGoingIndicators, doToggleGoing,
                              backfillRsvpForGroup, _refreshSheetContent.
    schedule.js               → Fetch/render pipeline: fetchAll, renderLegend,
                              renderSessions, sessionRow, loadData. Also owns the
                              filter-button/refresh-button/auto-refresh wiring,
                              which runs at module-load time (not inside an
                              exported init function), plus the delegated calendar
                              action on every session row.
    calendar.js               → Pure iCalendar serialization plus the client-side
                              `.ics` download helper and calendar icon. Exports UTC
                              start/end times, activity, rink/location, and the original
                              source URL when present; no account or backend state.
    groups-ui.js              → All group-related UI: bottom sheet, group info
                              sheet, manage-groups modal, intro modal,
                              renderGroupsRow.
    main.js                   → Entry point. Re-exports nothing; just imports
                              from the above and runs the bootstrap wiring
                              (DOM event listeners, initial render sequence)
                              that used to be the tail end of index.html's inline
                              script.
  Module dependency order (no cycles): utils.js, state.js, and
  activity-config.js are leaves → storage.js depends on utils.js and
  activity-config.js → schedule.js
  and rsvp.js both depend on utils.js/storage.js/state.js, and schedule.js
  additionally depends on activity-config.js and rsvp.js (for
  updateGoingIndicators). Note GOING_PERSON_SVG lives in
  utils.js, not schedule.js, specifically so rsvp.js can use it without
  creating a schedule.js↔rsvp.js circular import. → groups-ui.js depends on
  all of the above → main.js imports everything.
  A few small pieces of dead code were carried over unchanged during the split
  rather than opportunistically deleted (keeping each extraction step a pure,
  reviewable move): `hideStatus()` in schedule.js, `activeGroupSheet` state in
  state.js/groups-ui.js, and `sessionMatchesDayFilter()` in groups-ui.js are all
  defined but have zero call sites anywhere in the codebase. Safe to remove
  whenever convenient; not urgent.
/coaches/                  → index.html (public, indexable coach directory)
/mets-16aa-travel/         → Direct-link static travel logistics page for the
                              Seattle Junior Mets 16U AA 2026–27 season. Mobile-first,
                              unlinked, omitted from sitemap.xml, and protected
                              from indexing by both page metadata and _headers.
                              Contains no player-specific or private family data.
                              A daily GitHub Actions workflow compares every NWAHL
                              game involving the team with today's reviewed
                              baseline and opens one
                              issue for human review when the schedule changes or
                              the comparison cannot complete. It never edits or
                              deploys the page automatically.
                             (/about/ was deleted 2026-07-22 — see Search Visibility &
                              Routing below. It is now a normal missing URL served by
                              /404.html, not a redirect.)
/functions/
  /api/
    coaches.js             → GET all Live coaches from Airtable (KV read-through cached, key `coaches:list:v3`)
    /coach/
      [slug].js            → GET single coach by slug from Airtable (KV read-through cached, key `coaches:profile:v3:{slug}`)
    /groups/
      create.js            → POST create a group
      join.js              → POST join a group
      leave.js             → POST leave a group
      rsvp.js              → GET/POST session RSVPs (validates memberId — see Groups/RSVPs below)
      session.js           → GET/POST session sync
      nudge.js             → Legacy GET share text endpoint (no KV reads). Its former
                              button was inert and was removed from the schedule pages;
                              the unused endpoint remains for compatibility.
    schedule.js             → GET pre-scraped schedule from KV. Defaults to Stick &
                              Puck (`schedule:cache`) and accepts
                              `?activity=drop-in-hockey` or `?activity=public-skate`
                              for activity-specific caches written by the
                              scheduler Worker.
    rectimes.js, everett.js → per-rink live-scrape proxies
  /coaches/
    [slug].js              → Server-rendered coach profile pages (KV read-through cached, shares key `coaches:profile:v3:{slug}` with /api/coach/[slug].js)
/lib/
  activities.js             → Shared activity constants plus exact, source-specific
                              Drop-in Hockey allowlists/classifiers. Stick & Puck is
                              the default activity for backward compatibility.
  rinks.js                 → Rink config used by both schedule.js and the scheduler Worker
  scrapeAll.js              → Shared scraper orchestration, used by schedule.js (fallback) and the scheduler cron
  kvCache.js                → Generic KV read-through cache (stale-while-revalidate +
                              serve-stale-on-error). `readThrough(kv, key, freshMs,
                              staleTtlS, fetchFresh, waitUntil)`. Used by all three
                              coaches endpoints; falls back to a live fetch when `kv`
                              is absent. No Airtable/coaches specifics inside it.
                              Added 2026-07-16, commit `2b20051`.
  /scrapers/
    daysmart.js, rectimes.js, kentvalley.js, everett.js → per-rink scraping logic
/group-do/                  → Separate Cloudflare Worker (not a Pages Function) hosting the
                              GroupDO Durable Object class — one instance per group, deployed
                              via `wrangler deploy` from this directory (not part of the Pages
                              auto-deploy). See Groups/RSVPs below for why.
/scheduler/                 → Separate Cloudflare Worker running on a cron schedule: scrapes
                              all rinks once every 30 min and writes activity-specific KV
                              caches (`schedule:cache` for Stick & Puck,
                              `schedule:cache:drop-in-hockey` for Drop-in Hockey,
                              and `schedule:cache:public-skate` for Public Skate), then backs up
                              GROUPS KV + Durable Object group data to R2 daily. Also deployed
                              via `wrangler deploy` from this directory, independently of git
                              push. See Backups below.
/scripts/
  audit-rinks.js           → Node.js script, run locally only. Audits Stick & Puck,
                              Drop-in Hockey, and Public Skate terminology across
                              FareHarbor, DaySmart, RecTimes, Everett, and Kent Valley.
  health-check.js          → Node.js script, hits live endpoints, run locally only.
                              Checks every launched top-level page, including all three
                              schedule activities.
                              Includes `checkNotFound(path, note)` — asserts a path
                              returns HTTP 404 *and* isn't the homepage body, guarding
                              against the soft-404 regression described in Search
                              Visibility & Routing. Currently applied to an unknown
                              path and to `/about/`.
  admin-purge.js           → Local-only destructive-operation script; backs up before deleting
```

**Two deploy paths, easy to mix up:** `git push` to `main` auto-deploys the Cloudflare Pages site (everything under `/functions/`, plus static HTML). It does **not** deploy `/group-do/` or `/scheduler/` — those are separate Workers that only update when you run `wrangler deploy` from inside each directory. A commit that touches `group-do/src/group-do.js`, `scheduler/src/*.js`, or shared runtime imported by either Worker needs both `git push` (so the code is in version control and other Functions that reference it stay in sync) **and** a manual `wrangler deploy` in the affected Worker's directory. For the scheduler, shared runtime includes `lib/activities.js`, `lib/rinks.js`, `lib/scrapeAll.js`, and `lib/scrapers/*.js`. Pushing alone will not change the Worker's live behavior.

---

## Search Visibility & Routing

Established 2026-07-22 in commit `f23f83d` and expanded with the Coaches launch.
The publicly discoverable and indexable pages are `/`, `/stick-and-puck/`,
`/drop-in-hockey/`, `/public-skate/`, `/coaches/`, and every Live coach profile. Draft coach profiles and other
unfinished pages remain reachable by direct URL but are kept out of search;
deleted pages are gone.

### The three-part model

| Mechanism | Purpose |
|---|---|
| `sitemap.xml` | Lists launched pages, including all three schedule activities, the directory, and every Live coach profile. |
| `robots.txt` | `Allow: /`, plus a specific `Allow: /api/coaches` exception before `Disallow: /api/`. The exception lets search render the client-enhanced directory while other API routes remain blocked. Crawling is *permitted* for unfinished pages. |
| `<meta name="robots" content="noindex, nofollow">` | On each unfinished page. This is what actually keeps them out of search. |

**The critical interaction: never `Disallow` a page you're trying to `noindex`.**
Before this change, `robots.txt` disallowed `/coaches/` and `/about/` *and* those
pages carried `noindex`. That combination is self-defeating — a crawler blocked
by `robots.txt` never fetches the page, so it never sees the `noindex`, and the
URL can still be indexed URL-only from an external link. A page must be
crawlable for its `noindex` to be readable. `robots.txt` here is a crawl-budget
hint, **not access control**; unfinished pages remain fully reachable by direct
URL by design.

Pages currently carrying `noindex, nofollow`: Draft coach profiles and the
"Coach Not Found" 404 response in
`functions/coaches/[slug].js`, plus the direct-link static team logistics page
at `/mets-16aa-travel/`. Live coach profiles are indexable. When adding
any new unfinished section, add the meta tag to *every* HTML response it can
emit — server-rendered error pages are easy to miss.

`/`, `/stick-and-puck/`, `/drop-in-hockey/`, `/public-skate/`, `/coaches/`, and Live coach profiles must never carry
`noindex`.

### sitemap.xml conventions
`lastmod`, `changefreq`, and `priority` are deliberately **omitted**. They were
previously present and inaccurate (hand-maintained dates that drifted). Absent
values are better than misleading ones; don't reintroduce them without a process
that actually keeps them correct.

The sitemap and the crawlable fallback rows in `coaches/index.html` are
maintained manually. Whenever a coach changes between Draft and Live, add or
remove that coach's canonical profile URL and fallback row in the same
publishing workflow. Draft profiles must never appear in either place. The page
JavaScript replaces the fallback rows with fresh `/api/coaches` data for users;
the server-delivered rows ensure the directory still has substantive content
and profile links before JavaScript runs.

### Soft-404 / catch-all behavior
There is **no** `_redirects` file and no catch-all Function, and there must not
be one. Cloudflare Pages has an implicit SPA fallback: if a project has a root
`index.html` and **no root `404.html`**, any unmatched path is served the
homepage with **HTTP 200** — a soft 404. The site did exactly this until
2026-07-22.

Adding `404.html` at the repo root disables that fallback; Pages now serves the
nearest `404.html` with a real **HTTP 404**. This is purely a
presence-of-file behavior — there is no config to set, which also means
**deleting `404.html` silently reinstates the soft-404 bug.**

Route precedence is unchanged: Pages Functions still match before static-asset
resolution, so `/api/*` and `/coaches/<slug>` are unaffected. `/coaches/<slug>`
returns the function's *own* branded 404 (from `render404()` in
`functions/coaches/[slug].js`), never the root `404.html`.

### Deleting a section — cache gotcha
When a page is deleted, Cloudflare Pages does **not** invalidate its edge-cached
copy: cache invalidation on deploy covers assets that *changed*, and a deleted
path is no longer in the asset manifest. Static HTML is cached with
`s-maxage=604800` (7 days), so the deleted page keeps being served at its exact
URL until that expires.

`/mets-16aa-travel/` is an intentional exception: its `_headers` rule sets
`Cache-Control: no-cache` so frequently changing logistics revalidate. Treat
that as intended configuration until deployment, then confirm the actual
response header rather than assuming the repository rule was applied.

This bit `/about/` on 2026-07-22: the deploy was correct (`/about/?cb=1`
returned a proper 404 immediately) but the bare `/about/` URL kept serving the
old page — including its `meta http-equiv="refresh"` bounce to `/` — from a
cache entry ~10 h old. **After deleting any page, manually purge its URL:**
Cloudflare dashboard → Caching → Configuration → Purge Cached Content → Custom
Purge. Verify with a cache-busting query string first to confirm origin
behavior before concluding a deploy failed.

### Static source files may become public URLs
There is no build step, so ordinary files in the Pages static asset tree may
be served at their repository-relative paths. Reserved inputs such as
`functions/` and platform configuration are not ordinary static assets, so do
not infer exposure from Git tracking alone—verify the deployed URL and
headers. This is easy to forget for non-web files. When this document became tracked on
2026-07-22 it immediately became fetchable at
`https://postandin.com/instructions/postandin-technical-spec.md` (HTTP 200,
`text/markdown`) — an unintended indexable URL, contradicting the launch
boundary in effect at the time.

Fixed in `_headers` with `X-Robots-Tag: noindex, nofollow` on
`/instructions/*` — a header rather than a `robots.txt` `Disallow`, for
exactly the reason given above: a blocked crawler never reads the directive.
The file stays publicly readable by direct URL (the repo is public anyway);
it just stays out of search.

Before committing any new non-code file, ask whether it should be
world-readable at a predictable URL.

### Nav policy
Unfinished sections must not appear in navigation on any launched page,
including small footer links. Coaches is launched: the homepage includes a
"Find Your Coach" tool card, Stick & Puck
includes a persistent "Find Your Coach" header action, and the homepage, Stick
& Puck, and 404 footers link to `/coaches/`.

Homepage metadata (`<title>`, `description`, `og:title`, `og:description`)
advertises the launched Coaches and schedule sections, but must not
advertise unfinished sections.

---

## Frontend Conventions

- No JavaScript frameworks. Vanilla JS only.
- No CSS preprocessors. Plain CSS with custom properties.
- No npm dependencies in the browser.
- Pages use inline or co-located assets. The three schedule shells share
  `stick-and-puck/schedule.css` and native ES modules under
  `stick-and-puck/modules/`; there is still no framework, bundler, or compile
  step. New pages should default to the simplest local structure and share an
  existing subsystem only when behavior is genuinely common.
- Pages share a common nav pattern — copy from stick-and-puck/index.html as the reference implementation.
- Mobile responsive via CSS media queries. No CSS framework.
- Type sizing reference: match the Stick & Puck page for body and UI text size across all pages.

---

## Design System

### Typography
- **Bebas Neue** — display, headings, names, large UI labels. Loaded from Google Fonts.
- **IBM Plex Mono** — all body text, UI text, metadata, tags, labels. Loaded from Google Fonts.

### CSS Custom Properties
```css
--paper:  #E8E3D8   /* page background */
--panel:  #EFEBE2   /* secondary surfaces, sidebars, filter bars */
--card:   #DED9CD   /* card backgrounds, photo placeholders */
--mustard:#9A7B00   /* primary accent — borders, links, highlights */
--ink:    #141210   /* primary text, nav background */
--rule:   #B8B2A4   /* borders, dividers, secondary text */
```

### Aesthetic
Flyer/cream-paper. Warm, editorial, tactile. Not a sports tech product — closer to a community bulletin board that takes itself seriously.

### Layout Conventions
- **Nav:** always --ink background, white/muted text. Site chrome, not page content.
- **Page headers:** --paper background. Name/title in --ink. Mustard rule (`border-bottom: 2px solid var(--mustard)`) separates header from content.
- **Content areas:** --paper background for main, --panel for sidebars and secondary surfaces.
- **Tags/pills:** specialty tags use --mustard border and color; metadata tags use --rule border and muted color.
- **Hover states:** mustard border or mustard color on interactive elements.
- **Dark backgrounds:** --ink is reserved for the nav bar and small accent blocks only — not page headers or large content areas.

---

## Serverless Functions

Runtime: Cloudflare Pages Functions (Workers runtime, V8 isolates).

All functions live in /functions/. Cloudflare routes them automatically based on file path:
- `/functions/api/coaches.js` → available at `/api/coaches`
- `/functions/coaches/[slug].js` → available at `/coaches/[slug]`
- `/functions/coach-intake.js` → available at `/coach-intake`; validates and redirects to the configured Airtable form

### Function conventions
- Export named Cloudflare Pages handlers such as `onRequest`, `onRequestGet`, or
  `onRequestPost` as needed.
- Access environment variables via `context.env.VARIABLE_NAME`.
- Return `Response` objects directly.
- Cache headers are endpoint-specific: schedule responses use 120 seconds,
  coach and legacy proxy reads use 300 seconds, and public errors that should
  not persist use `no-store` where implemented.
  Note this header only governs *browser* caching — Pages Function responses
  aren't edge-cached by default, so the header alone does not shield an upstream
  (e.g. Airtable) from per-request load. Endpoints that need real server-side
  caching use the `lib/kvCache.js` read-through layer over the `GROUPS` KV
  namespace (currently all three coaches endpoints — see Data Flow — Coaches
  Directory).
- Never hardcode secrets. All credentials in Cloudflare environment variables.

### Error handling convention
Public-facing error responses (API JSON and rendered HTML) must never include
`e.message`, `e.stack`, upstream URLs, or binding names — those are internal
details that shouldn't reach a browser. Every catch block should:
1. `console.error(...)` the real error first, so it's still visible in
   Cloudflare's function logs.
2. Return a short, generic, user-safe message in its place, keeping the
   existing status code and response shape (e.g. `{ ok, sessions, error }`
   contracts that intentionally soft-fail with 200 shouldn't change shape —
   only the error text changes).

This applies to `functions/api/coaches.js`, `functions/api/coach/[slug].js`,
`functions/api/rectimes.js`, `functions/api/everett.js`, `lib/scrapeAll.js`
(consumed by `functions/api/schedule.js` and the scheduler cron), and the
client-side load-failure handling in `stick-and-puck/modules/schedule.js`'s
`loadData()` (moved out of `stick-and-puck/index.html` in the July 2026
module split — see File Structure above). Applies to any new endpoint going
forward too.

---

## External Services

### Airtable
- Used as the database for the Coaches directory.
- Base name: PostAndIn. Base ID: stored as the `AIRTABLE_BASE_ID` Cloudflare secret — not written out here (see Environment Variables & Secrets above for why).
- Table: Coaches. Key field: `slug` (URL-safe string, e.g. `mike-kowalski`).
- Status controls both listing visibility and per-slug access. Only records with
  `status = Live` are returned by `/api/coaches` (the directory list). The
  directory response omits all `contact_*` fields because its cards do not use
  them; contact methods are rendered only by the per-slug profile flow
  according to each coach's `contact_preference`. The per-slug HTML and JSON
  lookups accept `Live` or `Draft` records using
  `AND({slug} = "...", OR({status} = "Live", {status} = "Draft"))`; records with
  any other status do not resolve. This intentionally lets Draft coaches be
  previewed at their direct URL (with a red "DRAFT — NOT YET PUBLISHED" banner
  on the HTML page) while keeping them out of the public directory listing.
- Credentials stored as Cloudflare secrets: AIRTABLE_API_KEY, AIRTABLE_BASE_ID.
- API calls made server-side from Cloudflare Functions only — never from the browser.
- Pagination handled in coaches.js to ensure all records are fetched.
- Reads are fronted by a KV read-through cache (`lib/kvCache.js`) as of
  2026-07-16 (commit `2b20051`), so Airtable is hit at most once per key per
  5-min fresh window, and a stale copy is served if a refresh fails — this is
  what keeps the directory up during an Airtable rate-limit (5 req/s per base)
  or outage. See Data Flow — Coaches Directory for the full behavior.
- To add or edit coach records: use the Airtable UI at airtable.com directly.
- To make bulk changes or seed data: Codex prepares a curl command or Node
  script without credentials; the owner supplies credentials outside the tool
  and runs it.

### Cloudflare KV + Durable Objects (Groups feature)
Group membership and RSVP data now live in a **Durable Object** (`GroupDO`,
in the separate `group-do/` Worker), one instance per group, addressed via
`GROUP_DO.idFromName(slug)`. This replaced the original direct-KV storage to
eliminate create/join/leave/RSVP race conditions — Cloudflare serializes all
calls to a given DO instance, so there's no read-then-write window for a
concurrent request to slip into.

- **Slug format** (unchanged): `groupName.trim().toLowerCase() + "|" + password.trim().toLowerCase()`
- **DO storage layout:** `groupName` (string), `members` (`[{id, displayName}]`), `rsvp` (`{[sessionKey]: [displayName,...]}`), `migrated` (bool).
- **RSVP write validation:** `setRsvp` checks that the calling `memberId` is
  actually present in the group's `members` list before accepting the write,
  returning `{error: 'Not a member of this group'}` (surfaced as an HTTP 403
  by `functions/api/groups/rsvp.js`) if not. This closes a spoofing gap where
  anyone who knew a group's name/password could previously RSVP under an
  invented display name that wasn't a real member.
- **Read access is not session-gated** — `GET /api/groups/rsvp?groupSlugs=...`
  will return any group's RSVP map to anyone who supplies its slug. This is
  an intentional design decision, not an oversight: knowing the group
  name/password is the access control here, the same as a shared door code.
  RSVP entries are still keyed by `displayName`, not `memberId`, so duplicate
  display names within a group can still collide.
- **No group ownership model.** There is no `owner`/`creatorId` field
  anywhere in the schema — `create()` just seeds `members` with the creator
  as an ordinary entry, identical in every way to someone who joins later.
  If the creator leaves, the group (name, password, remaining members) is
  unaffected. If *every* member eventually leaves, the group's DO storage
  still exists with an empty `members` array — it isn't deleted, just
  becomes empty and rejoinable by name/password like normal.
- **No display-name uniqueness enforced, within a group or globally.**
  `join()` and `create()` never check a new display name against existing
  members. There's no account system at all — `displayName` is just a
  free-text string in each browser's `localStorage`, sent with every API
  call. Two different members of the same group can both be "Jordan," and
  the backend has no way to know or care. This is the same root cause as
  the RSVP-collision note above, not a separate issue.
- **`leave(slug, memberId)` purges the leaving member's display name from
  all RSVP lists** (added 2026-07-08, commit `60d3a54`, deployed via
  `wrangler deploy` from `group-do/`). Previously `leave()` only removed the
  member from `members` and left their name sitting in every session's
  `rsvp` array forever — visible to other members as "still going" long
  after they'd left. The fix mirrors the exact removal logic `setRsvp()`
  already uses for an ordinary "not going" toggle
  (`rsvp[sk].filter(n => n !== displayName)`), applied across all sessions
  at leave time. **Known limitation, deliberately accepted rather than
  solved:** if another *current* member of the group happens to share the
  departing member's exact display name, this can also remove that other
  member's legitimate RSVP — but this is not a new failure mode, it's the
  same displayName-collision limitation above, just reachable from one more
  trigger (leaving) instead of only one (toggling off). The alternative
  (only purge if no other current member shares the name) was considered
  and rejected: it would leave a departed member's name stuck showing as
  "going" *permanently* in the collision case, which is worse than today's
  bug being at least visible and explicable.
- **Lazy migration:** each DO instance seeds itself from the legacy
  `group:{slug}` / `rsvp:{slug}` KV keys the first time any method is called
  on it, then deletes those two KV keys. Groups nobody has touched since the
  migration deployed simply haven't migrated yet, and their data still lives
  in KV under those legacy keys.
- Namespace: GROUPS. Bound as variable name GROUPS in both the Pages project
  and (cross-Worker) the `scheduler` Worker's `wrangler.toml`.
- Remaining KV keys: `session:{sessionId}` → `{displayName, groups:[{groupName, displayName, password, memberId, color}]}` (still KV, not part of the DO migration), plus any not-yet-migrated `group:{slug}` / `rsvp:{slug}` records, plus the activity-specific schedule keys `schedule:cache`, `schedule:cache:drop-in-hockey`, and `schedule:cache:public-skate` (see Rink Data Sources), plus the coaches read-through cache keys `coaches:list:v3` and `coaches:profile:v3:{slug}` (the cache family was added 2026-07-16 in commit `2b20051`; both current keys are versioned — see Data Flow — Coaches Directory). Schedule cache keys use a 2-hour TTL; coaches cache keys use a 24-hour TTL. Only schedule and coach cache keys are freely regenerable. Session and legacy group/RSVP keys are user data and must not be deleted without a verified backup and recovery plan.
- Session key formats: Stick & Puck preserves
  `{rinkKey}|{YYYY-MM-DD}|{HH:MM}`; Drop-in Hockey and Public Skate append
  `|drop-in-hockey` and `|public-skate`, respectively. The activity suffix
  prevents cross-activity RSVP collisions without changing legacy Stick & Puck
  records.
- KV reads are gated by a non-HttpOnly cookie (`sp_has_session=1`) to prevent unnecessary reads from non-group visitors.
- The $5/month Workers Paid plan provides higher KV operation limits than the free tier.

### Backups
The `scheduler` Worker backs up group/RSVP data to an R2 bucket
(`postandin-backups`) daily, plus on-demand via its `/backup-now` endpoint,
with an expected 30-day expiry lifecycle rule managed outside this repository;
verify the rule in Cloudflare as described under External Configuration. This exists because of a prior incident
where a bad purge wiped GROUPS data with no recovery path. The local
`scripts/admin-purge.js` creates a pre-purge KV snapshot before deleting KV
keys, but it does not export Durable Object data; see the scheduler runbook for
the distinction and restore limits.

Two backup files are written per run:
- `backups/groups-YYYY-MM-DD.json` — full GROUPS KV namespace snapshot (also
  incidentally captures all three `schedule:cache` keys and the `coaches:list:v3` /
  `coaches:profile:v3:{slug}` cache keys, since they share the namespace). These
  cache entries are regenerable and harmless in a backup; they're not group data.
- `backups/groups-do-YYYY-MM-DD.json` — a best-effort sweep of Durable Object
  group data, via a read-only `export(slug)` method on `GroupDO` that never
  triggers migration or mutates state. Candidate slugs are derived from
  `session:*` KV records, since there's no built-in way to enumerate all
  live DO instances — **a group whose members have never hit
  `/api/groups/session` since migrating won't appear in this file.** This is
  a known, accepted gap, not a bug to "fix" without a different underlying
  mechanism.

See `scheduler/README.md` for the restore procedure.

### Google Fonts
- Bebas Neue and IBM Plex Mono are linked by all three schedule HTML shells.

---

## Authentication & Sessions (Groups feature)

No user accounts. Identity is established per-device via:
- localStorage on the client (postandin_groups, postandin_displayName, etc.)
- Server-side session cookie: `sp_sid` (HttpOnly, 1 year expiry, stored in KV)
- Gate cookie: `sp_has_session=1` (non-HttpOnly, prevents KV reads for non-group visitors)

Groups are identified by a name + password pair. No email, no OAuth, no third-party auth.
Membership, display name, localStorage, and the site-wide session cookies are
shared across all three activity pages: a user joins a group once and that group is
available on every schedule.
RSVP records are isolated by the activity-qualified
session key. The current group detail sheet is page-scoped, so each activity
shows only that activity's signups; there is no combined cross-activity
attendance view.

For group members, every session row includes a visible, 44px-minimum
“RSVP” action beside the calendar action. It is keyboard accessible, identifies
itself to assistive technology as the place to RSVP and see who is going, and
stops the row's source-link navigation. The one-time RSVP tip anchors to the
first RSVP action even when a session has no existing attendees.

The schedule UI never displays source-provided price, reservation, remaining-spots,
availability, or sold-out information. Every session row with a source URL stays
linked to that booking page, where users can check those details. Every activity
schedule session with source-provided exact start and end times has a 44px,
keyboard-accessible “Add to calendar” action. It stops the row's source-link navigation and immediately
downloads a client-generated `.ics` event; a session without an exact end omits
the action rather than fabricating a duration or exposing a control that cannot
work. There is no provider menu, confirmation dialog, calendar permission,
persistence, account, or backend request. The rest of the row retains its
existing source/session URL behavior.

### localStorage Keys
| Key | Purpose |
|---|---|
| postandin_groups | Array of {groupName, password, memberId, displayName, color} |
| postandin_displayName | User's display name |
| postandin_groups_intro_seen | Onboarding modal shown flag |
| postandin_icon_tip_seen | Person icon tooltip shown flag |
| postandin_join_confirmed | Post-join confirmation shown flag |

---

## Data Flow — Coaches Directory

1. Browser requests `/coaches/` → Cloudflare serves static
   `coaches/index.html`, including crawlable fallback rows for every Live coach
2. Page JS fetches `/api/coaches` and replaces the fallback rows with current
   data
3. `/api/coaches` (Cloudflare Function) resolves the coach list through a **KV
   read-through cache** (`lib/kvCache.js`, key `coaches:list:v3`) before touching
   Airtable — see the caching note below.
4. On a cache miss (or stale entry due for refresh) the function calls the
   Airtable REST API with filter `{status}="Live"`, maps the records, and caches
   the **mapped array**. It returns a bare JSON array with the
   `Cache-Control: public, max-age=300` browser header.
5. Page JS renders coach rows and wires up client-side filters
6. Results count only displays when at least one filter is active
7. User clicks a coach → navigates to `/coaches/[slug]`
8. `/coaches/[slug]` is handled by `/functions/coaches/[slug].js`
9. That function resolves the single record through the same read-through cache
   (key `coaches:profile:v3:{slug}`) and renders the full HTML response. The JSON
   endpoint `/api/coach/[slug]` shares the *same* per-slug cache key, so a
   profile-page view and an API call for the same coach warm each other's cache.
   This lookup requires the matching record to have `status = "Live"` or
   `status = "Draft"`, so both publishable states resolve here while any other
   status does not. Only the directory list (`/api/coaches`, step 3–4 above)
   remains restricted to `status = "Live"`. See "Draft coach preview" below.

### Caching note (added 2026-07-16, commit `2b20051`)
Until this change, every coaches request hit Airtable live — the
`Cache-Control: public, max-age=300` header only produces *browser* caching;
Cloudflare Pages Function responses are **not** edge-cached by default. Under
load this tripped Airtable's per-base rate limit (5 req/s, ~30s penalty), and
because any non-200 threw straight to a `502` with no fallback, the directory
would intermittently fail to load entirely.

All three coaches endpoints now read through `lib/kvCache.js`'s
`readThrough(kv, key, freshMs, staleTtlS, fetchFresh, waitUntil)`, backed by the
existing **`GROUPS` KV namespace** (no new binding — the same pattern
`functions/api/schedule.js` already uses). Behavior per key:
- **Fresh** (entry younger than `FRESH_MS` = 5 min): served directly, no Airtable call.
- **Stale** (older than 5 min, within `STALE_TTL_S` = 24 h): the cached copy is
  served immediately and a background `waitUntil` revalidation refreshes it; if
  that refresh fails (e.g. Airtable 429), the error is logged and the old copy
  is left intact — it never reaches the response. This is the serve-stale-on-error
  path that makes a warm cache survive an Airtable outage.
- **Cold** (no usable entry): fetched live and, only here, a genuine upstream
  failure still surfaces as the endpoint's existing error (`502` for the JSON
  endpoints; the `404` "Coach Not Found" page for the HTML profile — see the
  per-slug caching detail below).

**What each key caches differs by endpoint, intentionally:** `coaches:list:v3`
stores the already-**mapped** array (the list endpoint maps before caching),
while `coaches:profile:v3:{slug}` stores the **raw Airtable record** (the full
record including `r.id`, not just its `fields`), and each per-slug endpoint maps
or renders from that raw record on the way out. Caching the raw record keeps the
JSON body shape identical to before (the `/api/coach/[slug]` response includes
`id`, which lives on the record, not inside `fields`).

The per-slug HTML function (`functions/coaches/[slug].js`) now **throws** on a
non-OK Airtable response (it previously returned `null`), so a transient
upstream error is never written to cache as a sticky not-found — only a genuine
"no matching record" caches as a 404.

### Draft coach preview (added 2026-07-21)
Previously, both per-slug lookups (`functions/coaches/[slug].js` and
`functions/api/coach/[slug].js`) filtered on `AND({slug}="...", {status}="Live")`,
so a Draft coach's profile page 404'd — there was no way to preview a coach
before publishing except flipping status to Live. The lookup now accepts the
two allowed workflow states with
`AND({slug}="...", OR({status}="Live", {status}="Draft"))`, so:
- A coach's profile page and JSON endpoint resolve when the status is **Live or
  Draft**, letting a Draft record be reviewed at its real URL before publishing.
  Records with any other status do not resolve.
- The **directory list** (`/api/coaches`) is unchanged and still filters to
  `status = "Live"` only, so Draft coaches remain absent from `/coaches/`.
- `functions/coaches/[slug].js` now maps the `status` field and renders a
  red `DRAFT — NOT YET PUBLISHED` banner at the top of the HTML page whenever
  `status !== 'Live'`, so a previewed Draft page is visually unmistakable.
- Draft profiles carry `noindex, nofollow`, remain absent from `sitemap.xml`,
  and are unlinked from public pages. Live profiles are indexable and listed in
  the sitemap. Neither is blocked by `robots.txt`: crawlers must be able to
  fetch a Draft profile to read its `noindex` directive.
- Same 5-minute cache-freshness window applies: flipping a coach between
  Draft and Live may take up to 5 minutes to be reflected at their direct URL
  (see caching behavior above).

---

## Data Flow — Groups / RSVPs

1. Page loads → client checks for `sp_has_session=1` cookie
2. If present → fetches `/api/groups/session` to sync state from KV
3. If absent → no KV reads, groups UI shows join/create prompt only
4. User RSVPs to a session → POST to `/api/groups/rsvp` with sessionKey, groupSlug, memberId, displayName, going
5. `rsvp.js` forwards the call to that group's `GroupDO` Durable Object instance, which validates `memberId` against the group's actual member list before accepting the write (403 if it doesn't match — see Cloudflare KV + Durable Objects above)
6. Session key identifies the specific rink session. Stick & Puck uses the
   legacy `{rinkKey}|{YYYY-MM-DD}|{HH:MM}` key; Drop-in Hockey and Public Skate
   append `|drop-in-hockey` and `|public-skate`, respectively. Group membership
   is shared across pages, while the current page only resolves and displays
   RSVPs for its own loaded activity schedule.
7. User leaves a group → POST to `/api/groups/leave` → `leave()` on that
   group's `GroupDO` removes the member AND purges their display name from
   every session's RSVP list (see Cloudflare KV + Durable Objects above for
   the known same-display-name collision caveat)

---

## Rink Data Sources

Single source of truth: `lib/rinks.js` (the `RINKS` config). Both `functions/api/schedule.js`'s cold-start fallback and the `scheduler` Worker's cron import this same file via `lib/scrapeAll.js` — add a new rink there and nothing else needs updating.

As of the last resync, the actual per-rink sources are:

| Rink | System | Notes |
|---|---|---|
| Kraken Community Iceplex (Seattle) | DaySmart | |
| Sno-King Ice Arena — Renton, Kirkland, Snoqualmie | DaySmart | Three separate rink entries, one per location |
| Olympic View Arena (Mountlake Terrace) | RecTimes | **Not FareHarbor** — migrated at some point after this doc was first written; `lib/scrapers/rectimes.js` still links out to the FareHarbor booking URL for the "book" action, but session data itself comes from RecTimes |
| Lynnwood Ice Center (Lynnwood) | RecTimes | Same migration as Olympic View |
| Angel Of The Winds Arena (Everett) | Custom | One `everett` venue record covers both the `Community Rink` and `Main Rink` source sheets. |
| Kent Valley Ice Centre (Kent) | iCal (Google Calendar) | Separate feeds for Stick & Puck and Public Skate. No current public Drop-in Hockey feed was found. |

The legacy Pages proxies `functions/api/kentvalley.js` and
`functions/api/fareharbor.js` were deleted in commit `92e53ad`. Kent Valley is
handled by `lib/scrapers/kentvalley.js` through the shared schedule pipeline;
FareHarbor is not a live session-data source. The FareHarbor URLs retained in
`lib/scrapers/rectimes.js` are booking links only. Check `lib/rinks.js` before
assuming any rink system is current.

RecTimes Stick & Puck audience classification is shared across Olympic View
and Lynnwood. Reviewed exact labels are normalized into structured
`eligibility.audience` data in the shared scraper and use the harmonized
display subtitle `Female only`; unrelated clinics remain excluded even when
their names contain audience terms. The browser's
Female/Non-Binary filter uses that structured audience first, with a bounded
subtitle/title/source-label fallback for schedule caches written before the
structured field was populated. Adding a newly observed source label requires
review and an explicit mapping rather than broad automatic classification.
Because `lib/scrapers/rectimes.js` is imported by the scheduler Worker, changes
to this normalization require both a Pages deployment and a separate scheduler
Worker deployment.

The audit script (`scripts/audit-rinks.js`, run locally with
`node scripts/audit-rinks.js`) independently checks FareHarbor item lists,
DaySmart league names, Everett calendar titles, and Kent Valley iCal summaries
for session types not currently classified by the site. This is a
monitoring/discovery tool, separate from the live data path above. Run
periodically, especially when rinks update their schedules.

The shared scraper layer normalizes every emitted session with an `activity`
value. Supported values are `stick-and-puck`, `drop-in-hockey`, and
`public-skate`. Callers
still default to Stick & Puck for backward compatibility. The scheduler opts
into all supported activities during one scrape, then writes separate activity caches.
`/api/schedule` accepts those same values through the optional `activity` query
parameter; omission and explicit `activity=stick-and-puck` both preserve the
legacy `schedule:cache` behavior, while `activity=drop-in-hockey` reads
`schedule:cache:drop-in-hockey`; `activity=public-skate` reads
`schedule:cache:public-skate`. Unsupported values return `400`. Public Skate
has all-source infrastructure coverage and a public schedule page. Kent's separate
iCal feeds fail independently. For each DaySmart source, the Public Skate feed
fails independently of the combined hockey feed; a combined hockey-feed outage
affects that source's Stick & Puck and Drop-in Hockey results together.
Kraken Public Skate is selected from DaySmart sport `30`; Sno-King Public
Skate is selected from event type `12`, then split among the existing Kirkland
(`1`), Renton (`11`, `12`), and Snoqualmie (`13`, `14`) resource IDs. These
source-owned categories avoid relying on event-title matching.
Lynnwood contributes the exact RecTimes label `Public Skate`; Olympic View
contributes none because the rink explicitly does not offer general public
skating. Everett collects reviewed Stick & Puck, Drop-in Hockey, and Public
Skate labels from both its `Community Rink` and `Main Rink` sheets, while
excluding its separate check-in calendar. Each normalized Everett session
retains its source sheet. On Stick & Puck, Drop-in Hockey, and Public Skate,
the listing title is `Angel Of The Winds Arena` and the location subtitle is
exactly `Everett · Community Rink` or `Everett · Main Rink`. The same venue and
location distinction is preserved in the Groups attendance and RSVP views.
The location subtitle is independent of hockey-only session details, so Public
Skate displays it as well. Simultaneous sessions on the two sheets remain
separate listings. Community Rink keeps the legacy RSVP key; Main Rink adds
`|main-rink` before any activity suffix to prevent same-time RSVP collisions.
Everett's official site links to Bond Sports; the existing calendar endpoint
currently exposes the same event IDs and times and remains the production data
source. The source sheet allowlist, activity classifiers, display-label helper,
and RSVP-key behavior are implemented in `lib/scrapers/everett.js`,
`lib/activities.js`, `stick-and-puck/modules/utils.js`, and their schedule and
Groups consumers.

### Resolved Everett classification issue — `Public Skate Session`

Everett's published calendar contained an event whose visible title and sport
metadata conflicted. On Monday, 2026-08-17, the Main Rink event from
12:45–2:00 p.m. was titled `👪 Public Skate Session`, but opening the event on
the published site displayed the sport tag `Hockey` (the calendar API exposed
`sportIds: [10]`). The event was followed by a 2:00–2:10 p.m. ice cut and was
not marked cancelled.

On 2026-08-18, the rink confirmed by phone that this is an open public ice
skating session, not Drop-in Hockey, and that the `Hockey` sport tag is a source
metadata mistake that should be `Ice Skating`. Post & In therefore treats the
API title `👪 Public Skate Session` as an exact, Everett-specific Public Skate
label. It normalizes the displayed title to `Public Skate`, preserves the
source label internally, and does not classify the event as Drop-in Hockey.
Continue to ignore the erroneous broad sport tag for activity classification;
new Everett titles must still be reviewed and added explicitly rather than
matched fuzzily. The separate check-in calendar remains excluded before title
classification, even if it contains the same label.

Drop-in classification uses reviewed, source-specific exact labels rather than a broad fuzzy match. DaySmart
skater/goalie registration records are combined only when their league,
resource, start, end, and role-stripped base description all match.

The 2026-08-14 pre-launch coverage review resolved newly observed source names
conservatively. Kraken's `Adult Morning Skills Goalie Drop-in` remains excluded
because its published description identifies it as adult skills development,
not an open-hockey session. Sno-King's month-spanning `Rookies Stick N Puck`
labels are already classified as Stick & Puck and are recognized by the audit.
Everett's flagged hockey-skating, power-skating, Hockey Tots, and Hockey 1-4
titles remain excluded as instructional sessions. Kent Valley's `Open Stic &
Puck` was a one-off 2024 typo outside the production 30-day window and is
ignored by the full-history audit. Kraken's current Drop-In and Novice Drop-In
metadata establishes an 18+ minimum; its blank-description skater and goalie
registrations are combined using their published DaySmart team names rather
than an inferred capacity threshold.

---

## Coaches Data Model (Airtable)

| Field | Type | Notes |
|---|---|---|
| name | Single line text | |
| slug | Single line text | URL-safe, e.g. mike-kowalski |
| status | Single select | Submitted, Draft, Live. New form records default to Submitted and have no page. `/api/coaches` lists only Live records; per-slug HTML and JSON lookups accept Live or Draft and reject any other status. See "Draft coach preview" under Data Flow — Coaches Directory. |
| cert | Single line text | Optional. e.g. USA Hockey Level 4 · 18 years coaching |
| specialty | Multiple select | Power Skating, Edge Work, Goalie, Shooting / Finishing, Stickhandling, Defense, Hockey IQ, Strength & Conditioning, Overall Development, Video / Game Analysis, Mental Skills / Sports Psychology, Checking & Physical Play, Special Teams, Other |
| age_groups | Multiple select | 4U, 6U, 8U, 10U, 12U, 14U, 16U, 18U, Junior, Adult |
| levels | Multiple select | House / Recreational, Select / Tier 3, AA / Tier 2, AAA / Tier 1, Junior (USPHL / NAHL / BCHL / WHL), College (NCAA D1 / D3 / ACHA), Adult League, All Levels |
| rinks | Multiple select | Olympic View Arena, Lynnwood Ice Center, Sno-King Kirkland, Sno-King Renton, Sno-King Snoqualmie, Kraken Community Iceplex, Kent Valley Ice Centre, Angel Of The Winds Arena, Tacoma Twin Rinks, Sprinker Recreation Center, Bremerton Ice Center |
| private_lessons | Checkbox | |
| lessons_detail | Single line text | e.g. Year-round · Individual & small group |
| bio | Long text | 150–250 words |
| teaser | Single line text | One sentence for directory listing |
| teams_coached | Long text | One per line: Team Name · Role · Years |
| contact_email | Single line text | |
| contact_phone | Single line text | |
| contact_text | Single line text | |
| contact_preference | Multiple select | Email, Phone, Text |
| headshot_url | URL | |
| photo_urls | Long text | One URL per line, up to 3 |
| headshot_upload | Attachment | Required intake upload. Owner moves the approved image to permanent hosting and populates `headshot_url`; Airtable attachment URLs are not used publicly. |
| photo_uploads | Attachment | Optional intake uploads. Owner moves approved images to permanent hosting and populates `photo_urls`; Airtable attachment URLs are not used publicly. |
| personal_url | URL | Optional coach website or professional profile URL. Rendered as a single "Visit Website" link. |
| initials | Single line text | Two-letter fallback, e.g. MK |

New submissions default to `status: Submitted` and do not resolve to a profile
page. The owner moves a record to `Draft` when it is ready for direct,
unlisted preview, then to `Live` after coach approval.

---

## Coaches Directory UX

### Directory page (/coaches/)
- Page title: Find Your Coach
- Subhead: Seattle coaches offering private lessons and team coaching.
- Filter bar: Specialty, Age Group, Rink, Level, Private Lessons toggle. Select
  options are derived from the loaded Live coach data so Airtable values cannot
  drift out of sync. All filtering is client-side with no page reload.
- Results count: only shown when at least one filter is active.
- Coach rows: photo (72px, square) | name, cert, specialty tags, other tags, teaser | arrow. Mustard border on hover. Links to /coaches/[slug].
- Empty state: No coaches match your filters.
- Footer includes a subtle email contact link to `gholtgrieve@gmail.com`.
- CTA below list: Are You a Seattle Hockey Coach? with a primary link to
  `/coach-intake` and a subtle mailto link to `gholtgrieve@gmail.com` for
  questions or coaches who prefer not to use the form. The form is optional,
  not the only intake path.

### Profile page (/coaches/[slug])
- Breadcrumb: Coaches › [Name]
- Header: photo (108px), eyebrow (Seattle Hockey Coach), name (Bebas Neue 48px), cert, tags
- Two-column layout: main (bio, teams coached, optional website, photos) | sidebar (private lessons block, contact, rinks)
- Private lessons block (dark --ink panel): hidden entirely if private_lessons is false
- Contact: shows only methods the coach opted into
- Mobile: single column, sidebar stacks below main
- Back link: ← Back to coaches

### Coach intake
- Airtable native form used for coach submissions
- The published Airtable URL is kept in the Cloudflare
  `COACH_INTAKE_FORM_URL` environment variable; `/coach-intake` validates that
  it is an HTTPS Airtable URL and redirects to it. Missing or invalid
  configuration returns a branded, `noindex` 503 page with email and directory
  links rather than a raw error response
- Coaches may instead email `gholtgrieve@gmail.com`; the form is not required
- All new form submissions default to status: Submitted and produce no page.
  The owner changes a reviewed record to Draft for unlisted preview and to Live
  after approval

---

## Site Mission & Editorial Voice

Post & In exists to elevate the profile of Seattle youth hockey. Three priorities: Discovery (connecting players with scouts and next-level programs), Development (clearer pathways and better information for families), Celebration (telling the stories of players, coaches, and families).

### Key editorial decisions — do not contradict these
- "Seattle is a hockey city" — not "becoming a hockey city"
- No "not statements" in copy
- Tone: confident, community-first, outward-facing — aimed at the broader hockey world, not just local families
- Section titles: "The Arrival of Seattle Hockey" (not "The Rise"), "Focus on the People" (not "People, Not Stats")

### Current mission statement draft
> "Hockey in Seattle has never been stronger — and most of the hockey world doesn't know it yet. Since the Kraken arrived, the game here has transformed. The rinks are full. The programs are serious. A generation of Seattle kids is growing up with NHL hockey in their backyard, and it shows in how they play. Seattle youth hockey is already among the best on the West Coast. It's closing the gap with the traditional powers — Minnesota, Michigan, the Northeast — faster than anyone expected. Post & In exists to make that visible. We're a hockey family. We live this. And what we see on the ice every week in Seattle deserves a bigger audience. Not because of statistics — because of people. The coaches who've built programs from nothing. The twelve-year-old who hasn't missed a practice. The relationships between players, families, and rinks that turn a sport into something that shapes a life. Seattle is a hockey city. Post & In is here to tell that story."

---

## Current Status

| Page / Feature | Status | Notes |
|---|---|---|
| Homepage (index.html) | **Publicly launched & indexable** | Hero + mission statement plus two tool cards: "Find Ice Time" and "Find Your Coach." The Ice Time card advertises Stick & Puck, Drop-In Hockey, and Public Skate while retaining Stick & Puck as its default destination. |
| Stick & Puck (/stick-and-puck/) | Live — **publicly launched & indexable** | Primary feature, do not break. Listed in `sitemap.xml`; must never carry `noindex`. |
| Drop-in Hockey (/drop-in-hockey/) | Live — **publicly launched & indexable** | Uses the shared schedule UI with explicit `data-activity="drop-in-hockey"`, fetches `/api/schedule?activity=drop-in-hockey`, is linked from the activity switch and 404 page, and is listed in `sitemap.xml`. The homepage Ice Time card mentions Drop-In Hockey while continuing to link to Stick & Puck by default. |
| Public Skate (/public-skate/) | Live — **publicly launched & indexable** | Uses the shared schedule UI with `data-activity="public-skate"`, fetches `/api/schedule?activity=public-skate`, and shows time, place, duration, Groups/RSVPs, and calendar actions while omitting hockey program subtitles. Like every schedule, it does not present price, reservation, availability, remaining-spots, or sold-out information. Linked from the three-way activity switch and 404 page and listed in `sitemap.xml`. |
| 404 page (/404.html) | Live | Added 2026-07-22. Branded, links to Home, all three schedule activities, and Coaches. Its existence is load-bearing — deleting it silently restores Cloudflare Pages' soft-404 (HTTP 200 homepage for unknown URLs). See Search Visibility & Routing. |
| Groups feature | Live on all three schedules | Durable-Object-backed (migrated from direct KV), gated by cookie. Membership is shared across all schedules, RSVPs are activity-qualified, and each page shows only its activity's signups. |
| Coaches directory (/coaches/) | **Publicly launched & indexable** | Linked from the homepage and site footers, listed in `sitemap.xml`, and backed by the KV read-through cache added in commit `2b20051`. |
| Coach profile pages (/coaches/[slug]) | **Live profiles public and indexable; Draft profiles unlisted and noindex** | Server-rendered from Airtable, KV read-through cached, and sharing `coaches:profile:v3:{slug}` with `/api/coach/[slug]`. Live profiles have canonical/social metadata and sitemap entries. Draft profiles remain available for direct preview with a red banner but are excluded from the directory and search. The optional `personal_url` field renders as "Visit Website." |
| Mets 16U AA travel (/mets-16aa-travel/) | **Direct-link, unlinked, and noindex** | Static mobile-first logistics page for the Seattle Junior Mets 16U AA 2026–27 season. It is omitted from public navigation and `sitemap.xml`, remains crawlable so robots can read `noindex, nofollow`, and has matching `X-Robots-Tag` plus `Cache-Control: no-cache` in `_headers`. Open Graph and Twitter Card metadata use the public 1200×630 `social-preview.png` so direct shares can render a branded large-image preview without making the page indexable. Every trip with published game times repeats the reminder that the displayed times are game times, players must be in warmup attire and ready for pre-game warmups one hour earlier, and families should plan to arrive about 1 hour 15 minutes early; add that reminder when currently-TBD times are published. The travel-page visibility test enforces both the social metadata and that reminders appear if and only if a trip contains a published `<time datetime>`. The daily `check-nwahl-travel.yml` workflow compares every NWAHL game involving the team—including home games—with the reviewed JSON baseline and fingerprints the full team schedule so entry-level changes also alert. It opens one GitHub issue and, when SMTP secrets are configured, emails the private recipient list; it does not modify the page. Treat the URL as public-to-anyone-with-the-link; do not add player-specific itineraries, phone numbers, room assignments, medical details, or other private family data. |
| About (/about/) | **Deleted 2026-07-22** | `about/index.html` removed entirely in commit `f23f83d`. It had been a stub that meta-refreshed to `/` anyway, so its content was never actually reachable. `/about/` is now a normal missing URL served by `/404.html` — deliberately **not** a redirect to `/`, and deliberately absent from `robots.txt`. The previous "discrepancy" rows for this page are resolved by deletion. |
| Pathway (/pathway/) | **Deleted 2026-07-30** | The unfinished guide was removed entirely. `/pathway/` is now a normal missing URL served by `/404.html`, with no redirect and no sitemap or robots entry. It can be recovered from Git history if the project is revisited. |

### NWAHL travel-schedule monitor runbook

The monitor covers every NWAHL league game involving the team, home and away; it
does not check the Congressional Cup or Gopher State tournament sites. The JSON
baseline captured September 4, 2026 lives at
`data/nwahl-mets-16aa-travel.json` (the legacy filename is retained), and
`data/nwahl-mets-16aa-team.sha256` fingerprints every NWAHL entry involving the
team so entry-level changes are not missed.

Email recipients are stored only in the `NWAHL_ALERT_RECIPIENTS` GitHub Actions
secret. Gmail delivery additionally requires `NWAHL_ALERT_SMTP_USERNAME` and an
app password in `NWAHL_ALERT_SMTP_PASSWORD`. If any email secret is missing, the
email step is skipped and the GitHub issue remains the fallback alert. Never put
recipient addresses or SMTP credentials in tracked files. Change emails describe
added, removed, and modified games in plain language; an upstream outage sends a
separate message only to the SMTP owner saying that no schedule change has been
confirmed. The full recipient list is emailed only for confirmed schedule
differences.

When the workflow opens or updates an issue, inspect the workflow's current
schedule output against NWAHL, update the travel page if appropriate, then
replace the JSON baseline and regenerate the full-team fingerprint. Run
`node scripts/check-nwahl-travel.mjs`, copy its printed `Current full-team
fingerprint` value into `data/nwahl-mets-16aa-team.sha256`, and rerun the command
before closing the issue. GitHub can disable scheduled workflows after 60 days
without repository activity; if that happens, re-enable it with a manual
workflow run and confirm it passes.

---

## What to Build Next — Priority Order

1. ~~Complete Drop-in Hockey~~ — `/drop-in-hockey/`, its normal-link activity
   switch, activity-aware client configuration, Groups support, sitemap entry,
   and launch documentation are complete. The homepage Ice Time card advertises
   all three activities while retaining Stick & Puck as its default destination.
2. ~~Homepage refresh~~ — **partially done**: hero with mission statement plus Ice Time and Coaches tool cards are live. Spotlight modules are not yet built.
3. ~~Launch Coaches directory~~ — directory and Live profiles are public and indexable; Draft profiles remain unlisted and `noindex`.
4. Player spotlight feature — static, monthly, coach-nominated, one player per month
5. ~~Coach intake form~~ — Airtable form is live; the directory offers it as an optional submission path alongside direct email
6. Showcase/tournament calendar — PNW events scouts attend (Discovery pillar)
7. Seattle hockey alumni section — where are players who came up through Seattle now?
8. ~~Public Skate schedule~~ — launched with all-source schedule coverage,
   three-way activity navigation, time-and-place-only rows, and no Groups/RSVPs

---

## What Not To Do

- Do not introduce a build step, bundler, or package manager without explicit instruction
- Do not use React, Vue, or any JS framework
- Do not use a CSS framework (no Tailwind, no Bootstrap)
- Do not make Airtable API calls from the browser — server-side only
- Do not hardcode API keys or secrets in any file
- Do not recreate or link `/pathway/` unless explicitly instructed. Coaches is launched and should remain linked from public navigation.
- Do not add `Disallow:` for a page that carries `noindex` — the two cancel out. A crawler blocked in `robots.txt` never fetches the page and so never reads the `noindex`, leaving the URL indexable from external links. See Search Visibility & Routing.
- Do not delete `404.html`, and do not add a `_redirects` catch-all such as `/* /index.html 200`. Either one reinstates the soft-404 (unknown URLs served as the homepage with HTTP 200).
- Do not add `lastmod`, `changefreq`, or `priority` back into `sitemap.xml` without a process that keeps them accurate — they were removed for being stale and misleading.
- Do not assume a deleted page is gone once deployed — Cloudflare keeps serving its edge-cached copy (`s-maxage=604800`) at the exact URL. Purge that URL manually and verify with a cache-busting query string.
- Do not write the Airtable base ID, or any other value listed under "Required environment variables", into this document or any other tracked file — **this repo and this document are public.**
- Do not change the Stick & Puck page when working on other features
- Do not add npm dependencies without explicit instruction
- Do not make strategic, UX, or copy decisions unilaterally — scope those in chat first
- Do not return `e.message`, `e.stack`, or other internal error details in any public-facing API response or rendered HTML — log server-side, return a generic message (see Error handling convention above)
- Do not accept a client-supplied `memberId` for a group write without validating it against that group's actual member list first (see Cloudflare KV + Durable Objects above)
- Do not run `git push` and assume it deployed everything — `/group-do/` and `/scheduler/` require a separate `wrangler deploy` from within each directory; pushing to `main` only deploys the Pages site
- Do not add a new import to a `stick-and-puck/modules/*.js` file without checking the dependency order in File Structure above first — `utils.js` and `state.js` are leaves with no imports of their own; `schedule.js` and `rsvp.js` deliberately avoid importing from each other (that's why `GOING_PERSON_SVG` lives in `utils.js` instead of `schedule.js`) to prevent a circular import. If a new feature seems to need module A to import from module B and B to import from A, that's a sign the shared piece belongs in a lower-level module instead, not a sign to force the circular import through.

---

## Error Reporting

Google Form for user-reported issues:
https://docs.google.com/forms/d/e/1FAIpQLSeXw2VWloYrwHVheDhBlfeNtkIbDFvzuRqYNkEmmy_35uxAQg/viewform

Fields: What's the issue (dropdown including "Groups feature"), Which rink, Details (free text).
