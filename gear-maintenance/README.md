# Gear maintenance Worker

This independently deployed, scheduled Worker performs Gear retention cleanup,
provider-deletion retries, quarantine cleanup, photo reconciliation, and
failure/recovery alerting.

## Documentation

- [Gear overview](../docs/core/gear-exchange/README.md)
- [Scheduled maintenance contract](../docs/operations/gear-exchange/gear-production-maintenance.md)
- [Deployment and rollback](../docs/operations/gear-exchange/gear-launch-runbook.md)
- [Backup and recovery](../docs/operations/gear-exchange/gear-lean-backup.md)

## Deployment boundary

This Worker is not deployed by a Pages release. Changes under this directory or
to shared `lib/` modules it imports require an independent impact review and an
explicitly authorized deployment from this directory.

`wrangler.toml.example` is intentionally identifier-free. Production bindings,
secrets, triggers, and externally managed state must be verified outside the
repository before a release.
