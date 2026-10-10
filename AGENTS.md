# Post & In — Codex Working Agreement

Codex is the primary implementation agent for this repository. The human owner
sets product direction, UX, and copy. Claude Code reviews completed changes as a
separate second opinion.

## Start every task this way

1. Confirm the task is running in the canonical checkout by running `pwd`,
   `git rev-parse --show-toplevel`, and `git status --short`. The owner-facing
   path is `/Users/gordonholtgrieve/Dropbox/Documents/postandin` (a symlink to
   Dropbox's managed team folder). If the repository is under
   `/Users/gordonholtgrieve/Documents/Codex/`, another dated/generated folder,
   or any other clone, stop before editing and direct the owner to reopen the
   canonical checkout. Never copy or implement repository work in a generated
   Codex task folder.
2. Read this file.
3. Inspect `git status` and the actual files relevant to the request.
4. Start with `docs/README.md`, then read only the current product,
   platform, or operations documents relevant to the request.
5. Treat the codebase as the source of truth. If current documentation disagrees
   with the code, flag the mismatch and update the owning document in the same
   change when appropriate. Material under `docs/archive/` is historical,
   not current guidance.
6. Restate the requested outcome and identify any product, UX, or copy decision
   that still belongs to the owner.

Do not overwrite or discard pre-existing uncommitted work. Ask before touching
files that contain unrelated changes.

## Product boundaries and feature handoffs

Post & In has three core products: Ice Time, Coach Profiles, and Gear Exchange.
Seattle Junior Mets 16U AA pages and the Felix Holtgrieve profile are hosted
asides, not core products or roadmap items. Keep aside documentation under
`docs/asides/` unless a change also affects the shared platform.

For Gear Exchange work, start with
[docs/core/gear-exchange/README.md](docs/core/gear-exchange/README.md).
It links the current product contract, architecture, development instructions,
focused references, and operational runbooks. The completed implementation plan
and local development increments are historical material under
`docs/archive/gear-exchange/`; do not use them as current status.

## Implementation rules

- Keep the architecture deliberately simple: vanilla HTML, CSS, and JavaScript.
- Do not add a framework, build step, bundler, package manager, npm dependency,
  or CSS framework without explicit approval.
- Use the documented Post & In typography on every user-facing page: Bebas Neue
  for display text and IBM Plex Mono for body and UI text. Load the same font
  families and weights already used by the site; do not substitute lookalike or
  system fonts unless the owner explicitly approves an exception.
- Use the Oxford comma in Post & In copy and documentation.
- Keep the shared site shell visually consistent: a 52px dark navigation bar,
  warm paper background, centered content no wider than 1100px, mustard page
  rules, and the standard dark footer. Feature controls may differ, but they
  must not redefine the site chrome, palette, type scale, or content width.
- Keep changes narrowly scoped. Do not perform opportunistic redesigns or
  refactors.
- Never put credentials, tokens, Airtable identifiers, or private personal
  details in tracked files, logs, prompts, or commits. This repository is
  public.
- Never expose `e.message`, stacks, upstream URLs, or binding names in public
  responses. Log the real error server-side and return a generic safe message.
- `/pathway/` is intentionally deleted. Do not recreate or link it unless
  explicitly requested. Coaches is launched and should remain publicly linked.
- Do not remove `404.html` or add a catch-all 200 redirect.
- Do not change Stick & Puck while working on an unrelated feature.
- Preserve the dependency direction documented for
  `stick-and-puck/modules/*.js`; do not introduce circular imports.
- Validate a client-supplied group `memberId` against the group membership
  before any write.

## Work and deployment safety

- Work on a short-lived branch named `codex/<brief-task-name>`, not directly on
  `main`.
- Do not commit, push, merge, deploy, purge caches, mutate production data, or
  run destructive/admin scripts unless the owner explicitly asks for that
  action.
- A push to `main` deploys the Pages site automatically.
- Changes under `group-do/`, `scheduler/`, `gear-maintenance/` or `gear-images/`, and changes to shared runtime files
  imported by those Workers (for example `lib/activities.js`, `lib/scrapeAll.js`,
  or `lib/scrapers/*.js` for the scheduler and `lib/gear-image-*.mjs` for Gear Images), also require a separate
  `wrangler deploy` from the affected Worker's directory. Never imply that
  `git push` deployed those Workers.
- Do not use real secrets for testing. If live credentials or production writes
  would be required, stop and explain exactly what the owner must do.

## Verification

Choose checks based on the files changed and report exactly what ran.

- Always inspect `git diff --check` and the final diff.
- For JavaScript edits, run syntax checks where Node can parse the file.
- For schedule/scraper changes, run the relevant local scripts when safe:
  `node scripts/audit-rinks.js` and/or `node scripts/health-check.js`.
- For routing or visibility changes, verify `robots.txt`, `sitemap.xml`,
  `404.html`, page metadata, and unknown-path behavior together.
- For frontend changes, test the affected page at mobile and desktop widths and
  check the browser console.
- For API changes, test success, bad-input, and upstream-failure behavior,
  including that public errors reveal no internal details.
- Do not claim a check passed if it could not run. State the limitation and the
  remaining manual check.

## Documentation maintenance

- Treat `README.md` as the concise developer overview,
  `docs/README.md` as the documentation index, current material under
  `docs/core/`, `docs/platform/`, and `docs/operations/`
  as maintained guidance, and `scheduler/README.md` as the component scheduler
  and backup runbook. Files under `docs/archive/` are historical.
- Update affected documentation in the same change as routes, bindings, cache
  keys, activity behavior, deployment requirements, or operational commands.
- Update one canonical owner for a fact and link to it elsewhere rather than
  maintaining duplicate copies.
- Verify volatile claims directly against code/configuration. Avoid duplicating
  IDs, exact source labels, and CLI syntax unless the document owns that detail.
- For operational instructions, distinguish observed configuration from
  externally managed state that cannot be verified from the repository.
- Never describe a backup as restorable unless the restore path exists and its
  scope/limitations are documented and tested.

## Handoff for Claude review

When implementation and verification are complete, stop before commit/push and
give the owner:

- a concise summary of behavior changed;
- files changed;
- tests/checks run and their results;
- known risks or untested paths;
- the exact comparison Claude should review (normally
  `git diff main...HEAD` plus uncommitted changes);
- a suggested commit message.

The owner mediates every Claude review. Codex prepares a complete, copyable
review prompt and gives it to the owner. Codex must not invoke the Claude CLI,
Claude API, a Claude connector, or another external reviewer itself unless the
owner explicitly asks Codex to run that external service in the current
request. The normal workflow is: owner runs Claude in the canonical checkout,
owner returns Claude's report to Codex, then Codex investigates each finding.

If Claude reports a possible issue, investigate it against the code and tests.
Do not accept or dismiss review feedback automatically; explain the evidence.
