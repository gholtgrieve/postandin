# Post & In — Codex Working Agreement

Codex is the primary implementation agent for this repository. The human owner
sets product direction, UX, and copy. Claude Code reviews completed changes as a
separate second opinion.

## Start every task this way

1. Read this file.
2. Inspect `git status` and the actual files relevant to the request.
3. Read only the relevant sections of
   `instructions/postandin-technical-spec.md`.
4. Treat the codebase as the source of truth. If the technical spec disagrees
   with the code, flag the mismatch and update the spec in the same change when
   appropriate.
5. Restate the requested outcome and identify any product, UX, or copy decision
   that still belongs to the owner.

Do not overwrite or discard pre-existing uncommitted work. Ask before touching
files that contain unrelated changes.

## Implementation rules

- Keep the architecture deliberately simple: vanilla HTML, CSS, and JavaScript.
- Do not add a framework, build step, bundler, package manager, npm dependency,
  or CSS framework without explicit approval.
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
- Changes under `group-do/` or `scheduler/`, and changes to shared runtime files
  imported by either Worker (for example `lib/activities.js`, `lib/scrapeAll.js`,
  or `lib/scrapers/*.js` for the scheduler), also require a separate
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

If Claude reports a possible issue, investigate it against the code and tests.
Do not accept or dismiss review feedback automatically; explain the evidence.
