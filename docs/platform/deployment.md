# Deployment topology

Status: **current repository-derived boundaries**. Provider configuration is
external state and must be verified before a release.

## Deployment matrix

| Change | Runtime | Deployment path |
|---|---|---|
| Static pages, assets, or `functions/` | Cloudflare Pages | Push to `main` |
| `group-do/` | Group Durable Object Worker | `wrangler deploy` from `group-do/` |
| `scheduler/` | Schedule/backup Worker | `wrangler deploy` from `scheduler/` |
| Shared scheduler imports in `lib/` | Pages and scheduler Worker | Pages release plus scheduler deploy |
| `gear-maintenance/` | Gear maintenance Worker | Reviewed config/migrations plus deploy from its directory |
| Shared maintenance imports in `lib/` | Pages and maintenance Worker | Pages release plus maintenance deploy |
| `gear-images/` | Private Gear Images Worker | Reviewed binding/config plus deploy from its directory |
| Shared image-worker imports in `lib/` | Pages and image Worker | Pages release plus image-worker deploy |
| `.github/workflows/` | GitHub Actions | Merge/push according to workflow trigger |

A Git push never proves that an independent Worker was deployed. Verify every
affected runtime separately.

## Shared runtime imports

The exact import graph in code is authoritative. Known cross-runtime areas
include:

- scheduler: `lib/activities.js`, `lib/rinks.js`, `lib/scrapeAll.js`, and
  `lib/scrapers/`;
- Gear maintenance: Gear maintenance, alert, mail, validation, and product
  modules under `lib/`;
- Gear Images: Gear image-upload and provider-ID modules under `lib/`.

Inspect imports rather than relying only on the changed directory.

## Pages configuration

The repository does not contain a root Wrangler configuration for the Pages
project. Cloudflare supports Pages variables and bindings through either its
dashboard or a Pages Wrangler configuration, but this project's current values
and binding targets are externally managed state and cannot be proven from this
repository.

Before a Pages release, verify the deployed project has the expected names and
appropriate least-privilege access. Never record their values here:

- `AIRTABLE_API_KEY`, limited to read-only record access;
- `AIRTABLE_BASE_ID`;
- `COACH_INTAKE_FORM_URL`;
- `GROUPS`, a KV binding used for schedules, browser/group session data, and
  Coach Profiles caches; and
- `GROUP_DO`, a Durable Object binding for group RSVP state.

This list describes the shared platform configuration visible in current code.
Feature-specific production bindings remain owned by their product runbooks and
checked-in Worker configuration.

## Pages rollback

A Pages rollback is an owner-authorized production action:

1. In Cloudflare Pages, open the production project's **Deployments** view.
2. Identify the last known-good production deployment and use Cloudflare's
   rollback control.
3. Verify the production hostname, affected routes, response headers, and APIs.
4. Correct the original problem in Git and ship a reviewed forward fix.

Rollback restores an earlier Pages deployment; it does not roll back separately
deployed Workers, storage migrations, or production data. Handle those systems
only through their owning runbooks.

## Release safety

Do not push, merge, deploy, apply migrations, purge caches, or change production
data without explicit owner approval. Use no real secrets in tests. If validation
requires live credentials or writes, stop and identify the owner action required.

## Operations

- Schedule and Groups operations: [Ice Time and Groups](../operations/ice-time-and-groups.md)
- Gear release procedure: [Gear deployment and rollback](../operations/gear-exchange/gear-launch-runbook.md)
- Gear backup: [Gear backup and recovery](../operations/gear-exchange/gear-lean-backup.md)
