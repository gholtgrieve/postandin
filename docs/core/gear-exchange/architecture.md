# Gear Exchange architecture and security

Status: **current overview**. Code, migrations, and checked-in configuration are
authoritative for exact route and schema details.

## Storage

Production metadata is stored in D1 through additive migrations under
`migrations/gear/`. Local connected-preview tooling uses temporary SQLite files
and the same core storage concepts. Private provider identifiers and delivery
state are never part of the public listing projection.

## Request boundaries

- Public reads return a bounded, allowlisted projection and filter visibility and
  expiry at the storage boundary.
- Public writes require exact production origin, bounded JSON, explicit feature
  configuration, and route-specific validation.
- Seller writes require a valid session, CSRF value, current ownership, and an
  eligible listing state.
- Owner routes validate Cloudflare Access assertions and the exact owner
  allowlist before reading or writing moderation data.
- Errors expose generic messages publicly and retain diagnostic detail only in
  server-side logs.

## Email

Resend delivers verification, recovery, durable management, buyer-contact, and
maintenance-alert messages through bounded adapters. Ambiguous provider outcomes
must not be reported as definite failures. Logs avoid addresses and private
message content.

## Photos

The private `gear-images` service creates quarantine uploads and performs trusted
sanitization. D1 records durable ownership and attachment state. Public listing
responses replace private references with short-lived signed URLs. Cleanup and
reconciliation flow through the maintenance Worker and deletion outbox.

## Maintenance and backup

The separate `gear-maintenance` Worker performs daily retention cleanup, deletion
retries, and photo reconciliation. A separate GitHub Actions workflow exports an
encrypted records-only projection to off-provider storage. Photos are excluded.

## Detailed contracts

Use the focused files under [`reference/`](reference/) for route-specific
behavior. Operational procedures live under
[`docs/operations/gear-exchange/`](../../operations/gear-exchange/).
