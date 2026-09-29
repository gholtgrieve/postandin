# Gear Exchange local D1/workerd validation

Updated September 28, 2026. This is local integration evidence, not a deployment
or production database migration. No cloud resources, credentials, packages,
root Wrangler config or preview UI changes were added.

## Repeatable check

```bash
GEAR_WRANGLER_MODULE=/absolute/path/to/installed/wrangler node scripts/gear/d1-check.mjs
```

Requires Node 24 and an existing Wrangler installation with Miniflare/workerd.
The harness imports Wrangler's `unstable_splitSqlQuery` to preserve whole trigger
statements while splitting migration files, then applies each file using one D1
batch including a test-only migration ledger entry. This unstable helper is a
version-sensitive test dependency; rerun the check when upgrading Wrangler.
No production migration runner is provided or implied by this harness.

Observed installed versions: Wrangler 4.107.0, Miniflare 4.20260701.0, workerd
1.20260701.1. The harness compatibility date is 2026-07-01, matching the installed
runtime. A future deployment must choose/retest its own compatibility date.

Miniflare binds three local D1 databases in a temporary directory outside the
repo, with a minimal 404 Worker and loopback listener. Application modules execute
in Node against Miniflare's actual workerd-backed D1 binding, instead of the custom
Node SQLite adapter. This validates binding/SQL behavior; it does not exercise
an entire deployed Worker request handler. No remote bindings or API calls exist.
The harness disposes the runtime and removes temporary data on completion or
SIGINT/SIGTERM. Only sample fixtures are used; raw credentials aren't printed.

## Observed results

All nine check groups passed:

1. Failed migration batch rolls schema changes back.
2. All nine checked-in migrations apply to a fresh D1 database; the harness ledger
   makes repeated application a no-op. RETURNING and meta.changes have the expected
   shape, including a no-op update.
3. Atomic public report insertion, owner dismiss/remove/restore, seller-deletion
   blocking of owner restore and injected moderation-audit failure rollback work
   through the actual D1 binding. The
   indexed production moderation tables and 101-row bounded private open-report
   projection signal truncation and do not return seller email.
4. Publication, immutable adult acknowledgement, hosted-photo metadata, public
   projection, session recovery, JSON club aggregation, guarded edits and
   relisting work with the D1 binding.
5. Actual D1 duplicate errors on verification, edit, relist and email transfer
   map to generic failure; a failed edit rolls back
   the whole batch, including stale-duplicate cleanup.
6. Email transfer is atomic, including destination creation and session/link
   revocation. Injected failure, replay and existing-destination duplicate conflict
   behave correctly; resolving the conflict permits retry of the unconsumed token.
7. Two concurrent confirmation calls are serialized by D1 and cannot exceed ten
   active listings. Direct trigger rejection and the email-transfer quota failure
   are also checked, with unchanged-data assertions.
8. A populated version-6 database upgrades through version 9 with listing/session
   data preserved, legacy acknowledgement left NULL, and email transfer working afterward.
9. Stored data and migration bookkeeping survive disposal and restart of workerd.

The current 129-test Gear Node suite also passes. No runtime compatibility changes
to application code or SQL were required by this validation increment.

## Limits and handoff

This is a single local workerd runtime and D1 instance per test database. Competing
calls use that runtime; this is not distributed contention or remote D1 testing.
The minimal Worker does not expose application routes. Cloud bindings, deployment,
proxy/Origin behavior, remote migration commands, restore and real mail remain
unverified/unimplemented. The separate HTTPS Chrome check is documented in
`gear-management.md` and was not changed by this increment.

Fresh databases and a populated version-6 upgrade are covered. Earlier pre-key
sample schemas (versions 1–2) require the duplicate-key backfill that currently
exists only in `scripts/gear/local-db.mjs`; blindly applying SQL leaves their keys
NULL. There is no existing remote Gear database to upgrade. Before migrating any
legacy data to D1, implement/test an explicit maintenance backfill and conflict
resolution procedure. Do not treat this harness as that backfill or a production
migration tool.

Next bounded work, after review: add the source-only authenticated production
owner boundary using verified Cloudflare Access claims. Do not infer production
launch readiness from these checks.
Claude source review concluded ready to merge with no blocker/high/medium issues.
Its optional follow-ups are implemented on September 27: direct quota-trigger
checks, edit/relist duplicate failures, explicit link/session revocation asserts,
a migration-count guard, deterministic fixture times and documentation corrections.
All eight groups pass after these additions; the connected-preview re-review
also checked the specific email-transfer quota assertion and accepted the fix.

## Reference sources checked

- [Miniflare D1 binding access](https://developers.cloudflare.com/workers/testing/miniflare/storage/d1/)
- [D1 database API and transactional batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/)

Observed test results above come from running the harness, not just reading these
references. Local simulation does not substitute for eventual staging validation.
