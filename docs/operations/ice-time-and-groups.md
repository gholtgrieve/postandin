# Ice Time and Groups operations

Status: **current operational index**.

## Scheduler

The standalone scheduler Worker runs two independent jobs:

1. collect activity-specific Ice Time schedules every 30 minutes;
2. create a daily best-effort backup of Groups KV and Durable Object data.

The component runbook is [`scheduler/README.md`](../../scheduler/README.md). Read
its backup limitations before any bulk delete or reset.

## Schedule cache keys

| Activity | KV key |
|---|---|
| Stick & Puck | `schedule:cache` |
| Drop-in Hockey | `schedule:cache:drop-in-hockey` |
| Public Skate | `schedule:cache:public-skate` |

The scheduler and Pages schedule route share source modules under `lib/`. Update
both deployment paths when those imports change.

## Source maintenance

Add or change rinks in `lib/rinks.js`. Update activity classification,
orchestration, fixtures, tests, and documentation when the source introduces new
labels or behavior.

Run the live, read-only checks when appropriate:

```bash
node scripts/audit-rinks.js
node scripts/health-check.js
```

Reviewed production classifications belong in `lib/activities.js`. Known
audit-only exclusions belong in the audit script. Both require tests.

## Groups storage and recovery limitation

Current group membership and RSVPs live in per-group Durable Objects. Browser
session records and legacy migration keys live in KV. The scheduler can enumerate
KV but cannot reliably discover every Durable Object instance.

The daily backup therefore provides:

- a restorable KV snapshot by key;
- a best-effort read-only Durable Object export.

There is no complete Durable Object import path. Do not describe the Groups
backup as complete disaster recovery. The exact procedure and current limits are
in [`scheduler/README.md`](../../scheduler/README.md#groups-backups-data-safety-layer).

## Deployment

Pushing `main` does not deploy the scheduler or Group Durable Object Worker.
Their deployments require explicit owner approval and separate Wrangler commands
from the corresponding directories.
