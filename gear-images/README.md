# Gear Images Worker

This private, service-binding-only Worker performs provider-facing Gear image
operations after Pages routes validate seller authentication, feature
configuration, and request state. It has no intended public route.

## Documentation

- [Gear architecture and security](../docs/core/gear-exchange/architecture.md)
- [Photo pipeline contract](../docs/core/gear-exchange/reference/gear-production-photos.md)
- [Deployment and rollback](../docs/operations/gear-exchange/gear-launch-runbook.md)

## Deployment boundary

This Worker is not deployed by a Pages release. Changes under this directory or
to shared image modules it imports require an independent impact review and an
explicitly authorized deployment from this directory.

`wrangler.toml.example` is intentionally identifier-free. Keep provider account
details, signing material, secrets, and private object identifiers out of tracked
files and documentation.
