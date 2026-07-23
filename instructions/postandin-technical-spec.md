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

Post & In (postandin.com) is a static site with serverless API functions built for the Seattle youth hockey community. There is no build step, no framework, no bundler, and no package.json at the root. Everything is vanilla HTML, CSS, and JavaScript. Server-side logic lives exclusively in Cloudflare Pages Functions. The design philosophy is deliberate minimalism — add infrastructure only when the simplest possible approach breaks down.

The site owner is actively developing this into a mission-driven community platform. New features are scoped and designed conversationally before being handed to Claude Code for implementation. Do not introduce complexity that wasn't explicitly requested.

---

## Hosting & Deployment

- Platform: Cloudflare Pages, $5/month Workers Paid plan
- Deployment: Auto-deploys from the main branch of github.com/gholtgrieve/postandin
- Build step: None. Cloudflare serves files as-is.
- Custom domain: postandin.com, DNS managed in Cloudflare
- The paid Workers plan covers higher KV read/write limits and increased function invocations beyond the free tier

---

## GitHub Repository

- URL: github.com/gholtgrieve/postandin
- Branch strategy: single branch (main). All commits go directly to main and trigger a Cloudflare Pages deployment.
- No pull requests, no staging branch, no CI/CD pipeline beyond Cloudflare's auto-deploy.

### Browsing code on GitHub
- Navigate to github.com/gholtgrieve/postandin to see the full file tree
- Click any file to view its contents
- The commit history shows what changed and when — useful for understanding recent work

### Making changes
- All file edits are done locally via Claude Code, never directly on GitHub
- Local repo lives at ~/Dropbox/Documents/postandin
- Dropbox sync is active — the local repo is also backed up to Dropbox cloud storage

### Standard git workflow
```bash
cd ~/Dropbox/Documents/postandin && claude   # open Claude Code
# make changes via Claude Code
git add -A
git commit -m "Description of what changed"
git push
# Cloudflare deploys automatically in ~60 seconds
```

### Verifying a deployment
- Go to dash.cloudflare.com → Workers & Pages → postandin → Deployments tab
- Latest deployment should show Success
- Or curl the relevant endpoint and confirm it returns expected data

### Rolling back a bad deployment
- Go to Cloudflare Pages → Deployments tab
- Find the last good deployment → click ... → Rollback to this deployment
- Then fix the issue locally and push again

---

## Claude Code Workflow

Claude Code is the primary tool for making changes to the codebase. It is not used for strategic decisions, UX design, or copy — those happen in a separate Claude chat session first.

### To open Claude Code
```bash
cd ~/Dropbox/Documents/postandin && claude
```

### How to use it effectively
- Write a detailed prompt describing exactly what to build before opening Claude Code
- Include: which files to touch, what the output should look like, any design system constraints
- Claude Code will read existing files, make changes, and can run terminal commands
- Review changes before committing — Claude Code can make mistakes
- If something looks wrong, ask Claude Code to explain what it did before pushing

### What Claude Code is used for
- Creating and editing HTML, CSS, JS files
- Creating and editing Cloudflare Functions
- Running curl commands to test API endpoints
- Git add, commit, push
- Running the audit script (`node scripts/audit-rinks.js`)
- Making Airtable API calls via curl for data operations

### What Claude Code is NOT used for
- Strategic decisions about what to build
- UX and design decisions
- Copy and content decisions
- Accessing the Cloudflare dashboard
- Accessing Airtable directly (it uses curl against the API)

---

## Environment Variables & Secrets

All secrets are stored in Cloudflare Pages as encrypted secrets, never in the codebase.

### To view or update secrets
1. Go to dash.cloudflare.com
2. Workers & Pages → postandin → Settings → Environment Variables
3. Secrets show as "Value encrypted" — you cannot retrieve them after saving
4. To rotate a secret: create a new value in the external service, add it here, redeploy

### Current secrets
| Variable | Description |
|---|---|
| AIRTABLE_API_KEY | Personal Access Token from airtable.com/create/tokens. Scopes: data.records:read, data.records:write. Access: PostAndIn base only. |
| AIRTABLE_BASE_ID | The PostAndIn base ID. Read the live value from the Cloudflare dashboard (Settings → Environment Variables) or the Airtable API docs for that base — deliberately not written down here, see below. |

> **Why the base ID isn't printed here.** This document became a tracked file in
> the **public** repo on 2026-07-22. The base ID was previously written out in
> full in this table and in the Airtable section below. It isn't a credential on
> its own — an attacker still needs `AIRTABLE_API_KEY` — but it's a non-public
> identifier that was listed under "Current secrets", and once committed to a
> public repo it's in the git history permanently. Redacted when the file was
> first tracked, so it never entered public history. Don't paste it back in.

If you need to use a secret in Claude Code (e.g. for a curl command), generate a new PAT from Airtable, use it in the session, then update the Cloudflare secret. Never paste secrets into documents or chat.

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
                              Search Visibility & Routing below. Links only to Home and
                              Stick & Puck.
/stick-and-puck/           → index.html (Stick & Puck schedule — primary feature).
                              As of the July 8 2026 module split, index.html itself
                              contains no inline JS at all — just HTML/CSS and a
                              single `<script type="module" src="/stick-and-puck/
                              modules/main.js">` tag. All logic lives in:
  /modules/
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
                              exported init function).
    groups-ui.js              → All group-related UI: bottom sheet, group info
                              sheet, manage-groups modal, intro/sorry modals,
                              renderGroupsRow.
    main.js                   → Entry point. Re-exports nothing; just imports
                              from the above and runs the bootstrap wiring
                              (DOM event listeners, initial render sequence)
                              that used to be the tail end of index.html's inline
                              script.
  Module dependency order (no cycles): utils.js and state.js are leaves →
  storage.js depends on utils.js → schedule.js and rsvp.js both depend on
  utils.js/storage.js/state.js, and schedule.js additionally depends on
  rsvp.js (for updateGoingIndicators). Note GOING_PERSON_SVG lives in
  utils.js, not schedule.js, specifically so rsvp.js can use it without
  creating a schedule.js↔rsvp.js circular import. → groups-ui.js depends on
  all of the above → main.js imports everything.
  A few small pieces of dead code were carried over unchanged during the split
  rather than opportunistically deleted (keeping each extraction step a pure,
  reviewable move): `hideStatus()` in schedule.js, `activeGroupSheet` state in
  state.js/groups-ui.js, and `sessionMatchesDayFilter()` in groups-ui.js are all
  defined but have zero call sites anywhere in the codebase. Safe to remove
  whenever convenient; not urgent.
/coaches/                  → index.html (coach directory — noindex, nofollow; unlinked)
/pathway/                  → index.html (pathway guide — noindex, nofollow; unlinked)
                             (/about/ was deleted 2026-07-22 — see Search Visibility &
                              Routing below. It is now a normal missing URL served by
                              /404.html, not a redirect.)
/functions/
  /api/
    coaches.js             → GET all Live coaches from Airtable (KV read-through cached, key `coaches:list`)
    /coach/
      [slug].js            → GET single coach by slug from Airtable (KV read-through cached, key `coaches:profile:{slug}`)
    /groups/
      create.js            → POST create a group
      join.js              → POST join a group
      leave.js             → POST leave a group
      rsvp.js              → GET/POST session RSVPs (validates memberId — see Groups/RSVPs below)
      session.js           → GET/POST session sync
      nudge.js             → GET share text (no KV reads)
    schedule.js             → GET pre-scraped schedule from KV (written by scheduler Worker)
    rectimes.js, kentvalley.js, everett.js, fareharbor.js → per-rink live-scrape proxies
  /coaches/
    [slug].js              → Server-rendered coach profile pages (KV read-through cached, shares key `coaches:profile:{slug}` with /api/coach/[slug].js)
/lib/
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
                              all rinks every 30 min into schedule:cache (KV), and backs up
                              GROUPS KV + Durable Object group data to R2 daily. Also deployed
                              via `wrangler deploy` from this directory, independently of git
                              push. See Backups below.
/scripts/
  audit-rinks.js           → Node.js script, run locally only
  health-check.js          → Node.js script, hits live endpoints, run locally only.
                              Includes `checkNotFound(path, note)` — asserts a path
                              returns HTTP 404 *and* isn't the homepage body, guarding
                              against the soft-404 regression described in Search
                              Visibility & Routing. Currently applied to an unknown
                              path and to `/about/`.
  admin-purge.js           → Local-only destructive-operation script; backs up before deleting
```

**Two deploy paths, easy to mix up:** `git push` to `main` auto-deploys the Cloudflare Pages site (everything under `/functions/`, plus static HTML). It does **not** deploy `/group-do/` or `/scheduler/` — those are separate Workers that only update when you run `wrangler deploy` from inside each directory. A commit that touches `group-do/src/group-do.js` or `scheduler/src/*.js` needs both `git push` (so the code is in version control and other Functions that reference it stay in sync) **and** a manual `wrangler deploy` in that Worker's directory — pushing alone will not change its live behavior.

---

## Search Visibility & Routing

Established 2026-07-22, commit `f23f83d`. **Only two pages are publicly
discoverable and indexable:** `/` and `/stick-and-puck/`. Everything else is
either unfinished (reachable by direct URL, kept out of search) or gone.

### The three-part model

| Mechanism | Purpose |
|---|---|
| `sitemap.xml` | Lists **only** the two launched pages. Nothing else. |
| `robots.txt` | `Allow: /`, `Disallow: /api/` only. Crawling is *permitted* for unfinished pages. |
| `<meta name="robots" content="noindex, nofollow">` | On each unfinished page. This is what actually keeps them out of search. |

**The critical interaction: never `Disallow` a page you're trying to `noindex`.**
Before this change, `robots.txt` disallowed `/coaches/` and `/about/` *and* those
pages carried `noindex`. That combination is self-defeating — a crawler blocked
by `robots.txt` never fetches the page, so it never sees the `noindex`, and the
URL can still be indexed URL-only from an external link. A page must be
crawlable for its `noindex` to be readable. `robots.txt` here is a crawl-budget
hint, **not access control**; unfinished pages remain fully reachable by direct
URL by design.

Pages currently carrying `noindex, nofollow`: `coaches/index.html`,
`pathway/index.html`, and **both** HTML responses in
`functions/coaches/[slug].js` (the rendered profile and the "Coach Not Found"
404). When adding any new unfinished section, add the meta tag to *every* HTML
response it can emit — server-rendered error pages are easy to miss.

`/` and `/stick-and-puck/` must never carry `noindex`.

### sitemap.xml conventions
`lastmod`, `changefreq`, and `priority` are deliberately **omitted**. They were
previously present and inaccurate (hand-maintained dates that drifted). Absent
values are better than misleading ones; don't reintroduce them without a process
that actually keeps them correct.

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

This bit `/about/` on 2026-07-22: the deploy was correct (`/about/?cb=1`
returned a proper 404 immediately) but the bare `/about/` URL kept serving the
old page — including its `meta http-equiv="refresh"` bounce to `/` — from a
cache entry ~10 h old. **After deleting any page, manually purge its URL:**
Cloudflare dashboard → Caching → Configuration → Purge Cached Content → Custom
Purge. Verify with a cache-busting query string first to confirm origin
behavior before concluding a deploy failed.

### Every tracked file is a public URL
There is no build step, so Cloudflare Pages publishes the repository as-is:
**any file committed to `main` is served at its path on postandin.com.** This
is easy to forget for non-web files. When this document became tracked on
2026-07-22 it immediately became fetchable at
`https://postandin.com/instructions/postandin-technical-spec.md` (HTTP 200,
`text/markdown`) — a third indexable URL, contradicting the two-page rule
above.

Fixed in `_headers` with `X-Robots-Tag: noindex, nofollow` on
`/instructions/*` — a header rather than a `robots.txt` `Disallow`, for
exactly the reason given above: a blocked crawler never reads the directive.
The file stays publicly readable by direct URL (the repo is public anyway);
it just stays out of search.

Before committing any new non-code file, ask whether it should be
world-readable at a predictable URL.

### Nav policy
Unfinished sections must not appear in navigation on `/` or `/stick-and-puck/`,
including small footer links. Internal links *within* an unfinished section are
fine (a coach profile may link back to `/coaches/`). The homepage footer links
only to Stick & Puck; a commented-out "Find Your Coach" card sits in
`index.html` markup, hidden until that section ships.

Homepage metadata (`<title>`, `description`, `og:title`, `og:description`) must
also not advertise unfinished sections — it previously read "Ice Time, Coaches &
Pathways", which promised sections a visitor couldn't reach from the one
indexable page.

---

## Frontend Conventions

- No JavaScript frameworks. Vanilla JS only.
- No CSS preprocessors. Plain CSS with custom properties.
- No npm dependencies in the browser.
- All pages are self-contained — HTML, CSS, and JS in the same file or co-located.
  **Exception:** `stick-and-puck/index.html`'s JS lives in `stick-and-puck/modules/*.js`
  (ES modules, native browser `import`/`export`, no bundler — see File Structure
  above) rather than inline, following a July 2026 refactor to make the file
  maintainable. This is co-location (same directory tree), not a build step —
  still no framework, no bundler, nothing to compile. New pages should still
  default to fully inline/co-located unless they reach a similar size where
  splitting genuinely helps.
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
- `/functions/coaches/[slug].js` → available at `/coaches/[slug]/`

### Function conventions
- Export a default object with `onRequestGet`, `onRequestPost`, etc. as needed.
- Access environment variables via `context.env.VARIABLE_NAME`.
- Return `Response` objects directly.
- Cache headers on read-only endpoints: `Cache-Control: public, max-age=300`.
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
`functions/api/rectimes.js`, `functions/api/kentvalley.js`,
`functions/api/everett.js`, `functions/api/fareharbor.js`, `lib/scrapeAll.js`
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
- Status field controls *listing* visibility: only records with `status = Live` are
  returned by `/api/coaches` (the directory list). As of 2026-07-21, this filter
  does **not** apply to per-slug lookups — `/coaches/[slug]/` and
  `/api/coach/[slug]` resolve a coach by `slug` alone, regardless of status. This
  is intentional: it lets Draft coaches be previewed at their direct URL (with a
  red "DRAFT — NOT YET PUBLISHED" banner on the HTML page) before they're
  published, while staying out of the public directory listing.
- Credentials stored as Cloudflare secrets: AIRTABLE_API_KEY, AIRTABLE_BASE_ID.
- API calls made server-side from Cloudflare Functions only — never from the browser.
- Pagination handled in coaches.js to ensure all records are fetched.
- Reads are fronted by a KV read-through cache (`lib/kvCache.js`) as of
  2026-07-16 (commit `2b20051`), so Airtable is hit at most once per key per
  5-min fresh window, and a stale copy is served if a refresh fails — this is
  what keeps the directory up during an Airtable rate-limit (5 req/s per base)
  or outage. See Data Flow — Coaches Directory for the full behavior.
- To add or edit coach records: use the Airtable UI at airtable.com directly.
- To make bulk changes or seed data: Claude Code writes a curl command or Node script, you run it.

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
- Remaining KV keys: `session:{sessionId}` → `{displayName, groups:[{groupName, password, memberId, color}]}` (still KV, not part of the DO migration), plus any not-yet-migrated `group:{slug}` / `rsvp:{slug}` records, plus `schedule:cache` (see Rink Data Sources), plus the coaches read-through cache keys `coaches:list` and `coaches:profile:{slug}` (added 2026-07-16, commit `2b20051` — see Data Flow — Coaches Directory). All cache keys store `{data, fetchedAt}` with a 24 h `expirationTtl`, so they self-expire and are safe to delete at any time (they regenerate on the next request).
- Session key format: `{rinkKey}|{YYYY-MM-DD}|{HH:MM}`
- KV reads are gated by a non-HttpOnly cookie (`sp_has_session=1`) to prevent unnecessary reads from non-group visitors.
- The $5/month Workers Paid plan provides higher KV operation limits than the free tier.

### Backups
The `scheduler` Worker backs up group/RSVP data to an R2 bucket
(`postandin-backups`) daily, plus on-demand via its `/backup-now` endpoint,
with a 30-day expiry lifecycle rule. This exists because of a prior incident
where a bad purge wiped GROUPS data with no recovery path — see
`scripts/admin-purge.js`, which now requires an explicit backup before any
destructive KV operation.

Two backup files are written per run:
- `backups/groups-YYYY-MM-DD.json` — full GROUPS KV namespace snapshot (also
  incidentally captures `schedule:cache` and the `coaches:list` /
  `coaches:profile:{slug}` cache keys, since they share the namespace). These
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
- Bebas Neue and IBM Plex Mono loaded via `@import` in CSS.

---

## Authentication & Sessions (Groups feature)

No user accounts. Identity is established per-device via:
- localStorage on the client (postandin_groups, postandin_displayName, etc.)
- Server-side session cookie: `sp_sid` (HttpOnly, 1 year expiry, stored in KV)
- Gate cookie: `sp_has_session=1` (non-HttpOnly, prevents KV reads for non-group visitors)

Groups are identified by a name + password pair. No email, no OAuth, no third-party auth.

### localStorage Keys
| Key | Purpose |
|---|---|
| postandin_groups | Array of {groupName, password, memberId, color} |
| postandin_displayName | User's display name |
| postandin_groups_intro_seen | Onboarding modal shown flag |
| postandin_sorry_v2 | One-time apology popup shown flag — **corrected 2026-07-08: this doc previously said `postandin_sorry_v1`, but `stick-and-puck/modules/groups-ui.js`'s `closeSorryModal()` has always used `postandin_sorry_v2`. Pre-existing doc drift, unrelated to the module split — noticed while reading the actual code closely for an unrelated reason, fixed here.** |
| postandin_icon_tip_seen | Person icon tooltip shown flag |
| postandin_join_confirmed | Post-join confirmation shown flag |
| postandin_data_wiped_v1 | One-time data wipe sentinel |

---

## Data Flow — Coaches Directory

1. Browser requests `/coaches/` → Cloudflare serves static `coaches/index.html`
2. Page JS fetches `/api/coaches`
3. `/api/coaches` (Cloudflare Function) resolves the coach list through a **KV
   read-through cache** (`lib/kvCache.js`, key `coaches:list`) before touching
   Airtable — see the caching note below.
4. On a cache miss (or stale entry due for refresh) the function calls the
   Airtable REST API with filter `{status}="Live"`, maps the records, and caches
   the **mapped array**. It returns a bare JSON array with the
   `Cache-Control: public, max-age=300` browser header.
5. Page JS renders coach rows and wires up client-side filters
6. Results count only displays when at least one filter is active
7. User clicks a coach → navigates to `/coaches/[slug]/`
8. `/coaches/[slug]/` is handled by `/functions/coaches/[slug].js`
9. That function resolves the single record through the same read-through cache
   (key `coaches:profile:{slug}`) and renders the full HTML response. The JSON
   endpoint `/api/coach/[slug]` shares the *same* per-slug cache key, so a
   profile-page view and an API call for the same coach warm each other's cache.
   As of 2026-07-21, this lookup filters by `{slug}` only — **not** by
   `status` — so both Draft and Live coaches resolve here; only the directory
   list (`/api/coaches`, step 3–4 above) still filters to `status = "Live"`.
   See "Draft coach preview" note below.

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

**What each key caches differs by endpoint, intentionally:** `coaches:list`
stores the already-**mapped** array (the list endpoint maps before caching),
while `coaches:profile:{slug}` stores the **raw Airtable record** (the full
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
before publishing except flipping status to Live. That filter is now just
`{slug}="..."`, so:
- A coach's profile page and JSON endpoint resolve **regardless of status**
  (Draft or Live), letting the record be reviewed at its real URL before
  publishing.
- The **directory list** (`/api/coaches`) is unchanged and still filters to
  `status = "Live"` only, so Draft coaches remain absent from `/coaches/`.
- `functions/coaches/[slug].js` now maps the `status` field and renders a
  red `DRAFT — NOT YET PUBLISHED` banner at the top of the HTML page whenever
  `status !== 'Live'`, so a previewed Draft page is visually unmistakable.
- Since profile pages are already `noindex, nofollow`, absent from
  `sitemap.xml`, and unlinked from anywhere on the public site, this doesn't
  materially change the exposure model — it extends the existing "unlisted but
  reachable by direct URL" pattern to Draft coaches too. **Corrected
  2026-07-22:** this previously said profile pages were "blocked by
  `robots.txt`". They no longer are, and deliberately so — see Search
  Visibility & Routing. The `noindex, nofollow` meta tag is what keeps them out
  of search; blocking them in `robots.txt` would prevent crawlers from ever
  reading it.
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
6. Session key identifies the specific rink session: `{rinkKey}|{YYYY-MM-DD}|{HH:MM}`
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
| Everett Community Ice Rink | Custom (Angel of the Winds) | |
| Kent Valley Ice Centre (Kent) | iCal (Google Calendar) | |

`functions/api/fareharbor.js` still exists but has no live caller — `RINKS` has no `fareharbor` system entry anymore, so the only thing that ever called it (`fetchFareHarbor()` in `stick-and-puck/index.html`) is itself confirmed-dead client-side code, not something actually wired up. Don't assume FareHarbor is a current data source without checking `lib/rinks.js` first.

The audit script (`scripts/audit-rinks.js`, run locally with `node scripts/audit-rinks.js`) independently checks FareHarbor item lists, DaySmart league names, and iCal summaries for session types not currently captured by the site — this is a monitoring/discovery tool, separate from the live data path above. Run periodically, especially when rinks update their schedules.

---

## Coaches Data Model (Airtable)

| Field | Type | Notes |
|---|---|---|
| name | Single line text | |
| slug | Single line text | URL-safe, e.g. mike-kowalski |
| status | Single select | Draft, Live. Controls directory-listing visibility only (`/api/coaches` filters to Live). Since 2026-07-21, does not gate the per-slug profile URL — see "Draft coach preview" under Data Flow — Coaches Directory. |
| cert | Single line text | e.g. USA Hockey Level 4 · 18 years coaching |
| specialty | Multiple select | Power Skating, Edge Work, Goalie, Shooting / Finishing, Stickhandling, Defense, Hockey IQ, Strength & Conditioning, Overall Development, Video / Game Analysis, Mental Skills / Sports Psychology, Checking & Physical Play, Special Teams, Other |
| age_groups | Multiple select | 4U, 6U, 8U, 10U, 12U, 14U, 16U, 18U, Junior, Adult |
| levels | Multiple select | House / Recreational, Select / Tier 3, AA / Tier 2, AAA / Tier 1, Junior (USPHL / NAHL / BCHL / WHL), College (NCAA D1 / D3 / ACHA), Adult League, All Levels |
| rinks | Multiple select | Olympic View Arena, Lynnwood Ice Center, Sno-King Kirkland, Sno-King Renton, Sno-King Snoqualmie, Kraken Community Iceplex, Kent Valley Ice Centre, Angel of the Winds Arena, Everett Community Rink, Tacoma Twin Rinks, Sprinker Recreation Center, Bremerton Ice Center |
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
| elite_prospects_url | URL | Renamed from the originally-planned `profile_links` (long text, multi-URL) field — the actual Airtable base and `functions/api/coaches.js`'s FIELDS list both use `elite_prospects_url`, a single URL, not a multi-line list |
| initials | Single line text | Two-letter fallback, e.g. MK |

New submissions default to `status: Draft`. Owner reviews and sets to `Live` when approved.

---

## Coaches Directory UX

### Directory page (/coaches/)
- Page title: Find Your Coach
- Subhead: Seattle coaches offering private lessons and team coaching.
- Filter bar: Specialty, Age Group, Rink, Level, Private Lessons toggle. All client-side, no page reload.
- Results count: only shown when at least one filter is active.
- Coach rows: photo (72px, square) | name, cert, specialty tags, other tags, teaser | arrow. Mustard border on hover. Links to /coaches/[slug]/.
- Empty state: No coaches match your filters.
- CTA below list: Are You a Seattle Hockey Coach? with mailto link (gholtgrieve@gmail.com — a real address, not a placeholder) for coaches to express interest.

### Profile page (/coaches/[slug]/)
- Breadcrumb: Coaches › [Name]
- Header: photo (108px), eyebrow (Seattle Hockey Coach), name (Bebas Neue 48px), cert, tags
- Two-column layout: main (bio, teams coached, photos) | sidebar (private lessons block, contact, rinks, profile links)
- Private lessons block (dark --ink panel): hidden entirely if private_lessons is false
- Contact: shows only methods the coach opted into
- Mobile: single column, sidebar stacks below main
- Back link: ← Back to coaches

### Coach intake
- Airtable native form used for coach submissions
- Google Form being built as alternative intake method
- All new submissions default to status: Draft until reviewed and approved by site owner

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
| Homepage (index.html) | Partially rebuilt — **publicly launched & indexable** | Hero + mission statement copy live, one tool card ("Find Ice Time" → Stick & Puck) live. Coaches/Pathway/Spotlights don't have their own module cards yet — a "Find Your Coach" card exists in the markup but is commented out as "hidden until ready." **As of 2026-07-22 the footer links only to Stick & Puck** (Coaches/Pathway links removed), and the page metadata no longer advertises unfinished sections — title is now `Post & In \| Seattle Stick & Puck Ice Time`. See Search Visibility & Routing. |
| Stick & Puck (/stick-and-puck/) | Live — **publicly launched & indexable** | Primary feature, do not break. One of only two pages in `sitemap.xml`; must never carry `noindex`. |
| 404 page (/404.html) | Live | Added 2026-07-22. Branded, links only to Home and Stick & Puck. Its existence is load-bearing — deleting it silently restores Cloudflare Pages' soft-404 (HTTP 200 homepage for unknown URLs). See Search Visibility & Routing. |
| Groups feature | Live | Durable-Object-backed (migrated from direct KV), gated by cookie — see External Services below |
| Coaches directory (/coaches/) | Under development — unlisted, reachable by direct URL | **As of 2026-07-22:** carries `noindex, nofollow`; absent from `sitemap.xml`; **no longer disallowed in `robots.txt`** (it must be crawlable for the `noindex` to be read — see Search Visibility & Routing); not linked from any publicly launched page. **KV read-through cached as of 2026-07-16 (commit `2b20051`)** — fixes the prior slow/intermittent-failure behavior; see Data Flow — Coaches Directory. |
| Coach profile pages (/coaches/[slug]/) | Live, unlisted | Server-rendered from Airtable, **KV read-through cached as of 2026-07-16 (commit `2b20051`)**, sharing the per-slug cache key with `/api/coach/[slug]`. **As of 2026-07-21, resolves by slug regardless of status** — Draft coaches are viewable at their direct URL (with a red "DRAFT — NOT YET PUBLISHED" banner) for pre-publish preview, while still excluded from the `/coaches/` directory list; see "Draft coach preview" under Data Flow — Coaches Directory. **Known open bug (not yet fixed):** `functions/coaches/[slug].js` maps its Links section from a non-existent `links` field instead of `elite_prospects_url`, so the Links block never renders on server-rendered profiles. Deliberately left untouched by both the caching change and the Draft-preview change; slated as the next fix. |
| About (/about/) | **Deleted 2026-07-22** | `about/index.html` removed entirely in commit `f23f83d`. It had been a stub that meta-refreshed to `/` anyway, so its content was never actually reachable. `/about/` is now a normal missing URL served by `/404.html` — deliberately **not** a redirect to `/`, and deliberately absent from `robots.txt`. The previous "discrepancy" rows for this page are resolved by deletion. |
| Pathway (/pathway/) | Under development — unlisted, reachable by direct URL | **Resolved 2026-07-22.** The long-standing contradiction (linked from the homepage footer and listed in `sitemap.xml`, despite the "do not link" rule) has been rolled back rather than ratified: `/pathway/` is now removed from `sitemap.xml`, removed from the homepage footer, and carries `noindex, nofollow`. It remains reachable by direct URL for review. |

---

## What to Build Next — Priority Order

1. ~~Homepage refresh~~ — **partially done**: hero with mission statement and one feature module (Ice Time) are live. Coaches, Pathway, and Spotlights modules are not yet built as their own cards — check `index.html` directly before assuming this is fully finished or fully outstanding.
2. Coaches page design fixes — lighten dark header treatment, increase body type size to match Stick & Puck, results count only when filters active (**already implemented** — verify against `coaches/index.html` before redoing it), replace CTA placeholder email with real address (**already done** — see Coaches Directory UX above)
3. Player spotlight feature — static, monthly, coach-nominated, one player per month
4. Coach intake form — Airtable native form being configured for coach self-submission
5. Showcase/tournament calendar — PNW events scouts attend (Discovery pillar)
6. Seattle hockey alumni section — where are players who came up through Seattle now?

---

## What Not To Do

- Do not introduce a build step, bundler, or package manager without explicit instruction
- Do not use React, Vue, or any JS framework
- Do not use a CSS framework (no Tailwind, no Bootstrap)
- Do not make Airtable API calls from the browser — server-side only
- Do not hardcode API keys or secrets in any file
- Do not link `/coaches/` or `/pathway/` from `/` or `/stick-and-puck/` until explicitly instructed. (This rule used to name `/about/` too, and used to carry a note that `/pathway/` contradicted it in production — both are resolved as of 2026-07-22: `/about/` is deleted and `/pathway/` was rolled back to unlisted. See Search Visibility & Routing.)
- Do not add `Disallow:` for a page that carries `noindex` — the two cancel out. A crawler blocked in `robots.txt` never fetches the page and so never reads the `noindex`, leaving the URL indexable from external links. See Search Visibility & Routing.
- Do not delete `404.html`, and do not add a `_redirects` catch-all such as `/* /index.html 200`. Either one reinstates the soft-404 (unknown URLs served as the homepage with HTTP 200).
- Do not add `lastmod`, `changefreq`, or `priority` back into `sitemap.xml` without a process that keeps them accurate — they were removed for being stale and misleading.
- Do not assume a deleted page is gone once deployed — Cloudflare keeps serving its edge-cached copy (`s-maxage=604800`) at the exact URL. Purge that URL manually and verify with a cache-busting query string.
- Do not write the Airtable base ID, or any other value listed under "Current secrets", into this document or any other tracked file — **this repo and this document are public.**
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
