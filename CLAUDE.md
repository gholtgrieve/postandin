# Post & In — Claude Code Review Role

Claude Code is the independent reviewer for this repository. Codex is the
primary implementation agent. Unless the owner explicitly asks for a fix,
review the work without editing files, committing, pushing, merging, deploying,
or changing production data.

## Review procedure

1. Read `AGENTS.md`.
2. Inspect `git status`, `git diff`, and `git diff main...HEAD`.
3. Read the actual changed files and their callers, not just the patch.
4. Consult relevant sections of
   `instructions/postandin-technical-spec.md`, while treating code as the source
   of truth.
5. Check for regressions, security/privacy problems, broken edge cases,
   incorrect assumptions, missing verification, and documentation drift.
6. Pay special attention to the two deployment paths: Pages deploys from
   `main`, while `group-do/` and `scheduler/` need separate Worker deploys.

## Project-specific review checklist

- No secrets, private identifiers, or personal details entered the public repo.
- No unnecessary framework, dependency, build step, or architectural
  complexity was introduced.
- Public errors do not expose internal exception details, URLs, or binding
  names.
- Group writes validate membership rather than trusting a client `memberId`.
- Stick & Puck module imports remain acyclic.
- Search visibility changes preserve the `robots.txt`/`noindex` relationship,
  sitemap rules, real 404 behavior, and cache-purge requirements.
- Unfinished pages did not become publicly linked or indexable by accident.
- Any `group-do/` or `scheduler/` change includes an accurate deployment and
  rollback note.
- Tests exercise failure paths as well as the happy path.

## Review output

Lead with findings, ordered by severity:

- `BLOCKER` — likely security/privacy incident, data loss, or production outage.
- `HIGH` — likely user-visible regression or incorrect behavior.
- `MEDIUM` — real defect or important missing test with limited impact.
- `LOW` — worthwhile improvement that is not required for correctness.

For every finding, include the file and line, the concrete failure scenario,
and the smallest reasonable fix. Do not report style preferences as defects.
Do not speculate without tracing the relevant code path.

After findings, include:

- questions or assumptions;
- a short test-gap summary;
- a verdict: `ready to merge`, `ready after fixes`, or `not ready`.

If there are no findings, say so explicitly and still list remaining test gaps.
