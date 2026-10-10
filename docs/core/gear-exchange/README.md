# Gear Exchange

Status: **current core product; launched October 4, 2026**.

Gear Exchange is an adult-only local hockey classifieds service for For Sale,
Trade, and Free listings. Production browse, posting, verification, seller
management, buyer contact, reporting, moderation, photos, scheduled maintenance,
and encrypted records backup are implemented.

## Start here

- [Product contract](product-contract.md)
- [Architecture and security](architecture.md)
- [Local development](local-development.md)
- [Deployment and rollback](../../operations/gear-exchange/gear-launch-runbook.md)
- [Backup and recovery](../../operations/gear-exchange/gear-lean-backup.md)
- [Scheduled maintenance](../../operations/gear-exchange/gear-production-maintenance.md)

There is no queued Gear implementation task. Await owner direction and verify
the current code and Git state before starting new work.

## Production components

```text
/gear/ browser
  -> Pages Functions
  -> D1 records
  -> Resend transactional mail
  -> Turnstile public-write checks
  -> private gear-images Worker and Cloudflare Images
  -> private owner workspace protected by Cloudflare Access

gear-maintenance Worker
  -> daily cleanup, retry, and image reconciliation

GitHub Actions
  -> encrypted records-only off-provider backup
```

The backup deliberately excludes photos. A total media loss requires sellers to
upload photos again.

## Detailed reference

The reference directory keeps focused, current implementation contracts:

- [Owner authentication](reference/gear-access.md)
- [Buyer contact](reference/gear-production-contact.md)
- [Seller deletion and recovery](reference/gear-production-deletions.md)
- [Seller management](reference/gear-production-management.md)
- [Owner moderation](reference/gear-production-moderation.md)
- [Photo pipeline](reference/gear-production-photos.md)
- [Listing reports](reference/gear-production-reports.md)
- [Posting and verification](reference/gear-production-verification.md)
- [D1/workerd validation](reference/gear-d1-validation.md)

Historical local-only increments and the completed implementation plan are under
[`docs/archive/gear-exchange/`](../../archive/gear-exchange/).

## Deployment boundary

Pages, `gear-images`, and `gear-maintenance` have separate release paths. Shared
modules imported by a Worker can require its redeployment even when the Worker
directory did not change. Never infer Worker deployment from a Git push.

## Safety

- Use sample data for local development.
- Do not use live credentials or production writes without explicit approval.
- Validate authorization, ownership, origin, CSRF, content bounds, and feature
  configuration on the server.
- Never expose internal errors, seller email addresses, private image references,
  credentials, or provider details in public responses.
