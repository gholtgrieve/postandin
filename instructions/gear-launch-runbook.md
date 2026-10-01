# Gear Exchange launch and rollback runbook

Status: source-only launch plan. Nothing in this document authorizes a push,
merge, migration, resource change, secret write, mail delivery, image upload or
deployment. The owner must explicitly approve deployment after the decisions and
staging gates below are complete.

## Release boundary

Gear has four independently released surfaces:

1. the existing Pages project (`functions/api/gear/**` and `/gear/**`);
2. the service-binding-only `postandin-gear-images` Worker (`gear-images/`);
3. the cron-only `postandin-gear-maintenance` Worker (`gear-maintenance/`);
4. an external, non-Cloudflare backup runner.

A Git push can deploy Pages. It does not deploy either Worker and must never be
treated as doing so. The backup runner must not share the Cloudflare account,
storage account or encryption-key custody it is intended to protect.

## Decisions required before provisioning

Record these in the private operator record, not in Git:

- exact owner identities and identity provider for Cloudflare Access, with MFA;
- maintenance failure/recovery alert recipient;
- off-Cloudflare object-storage provider, external runner location and billing
  owner;
- encryption-key custodian and a second person/location holding a recovery copy;
- the Cloudflare plan/rules available for the required per-IP edge limits;
- a separate Cloudflare account for the entire staging/recovery stack (Pages,
  both Workers, D1, KV, Images and Access), plus separate staging and production
  names and backup prefixes.

Do not put account IDs, database IDs, access audiences, owner emails, API tokens,
signing keys or backup keys in this repository.

## Gate 1: backup and recovery first

Do not enable public writes until a complete recovery rehearsal passes.

The nightly external job must run away from the 11:00 UTC maintenance window and:

1. request a full D1 SQL export through the polling export API and retain its
   time-travel bookmark on the external runner only;
2. load that transient export into an isolated local SQLite process and create a
   retention-safe logical snapshot. Include published/recoverable listings and
   their sellers, clubs and attached `gear_photos`; reports, removals, moderation
   history, seller-deletion markers and the deletion ledger only within their
   existing deadlines. Exclude every unverified draft, contact attempt/message,
   verification token, management link/session, pending email change, upload
   counter, quarantine row and photo-deletion-outbox row. Delete the raw SQL and
   temporary database immediately after packaging;
3. enumerate only `gear_photos.provider_id` values attached to listings included
   in that logical snapshot and download those already-sanitized private originals
   through the Images export API. Never back up quarantine originals or objects
   queued in `gear_photo_deletions`;
4. export the current deletion ledger again after the image pass, so a restore
   cannot resurrect a seller purge that completed after the database snapshot;
5. create a versioned manifest containing a random backup ID, intended object key,
   export bookmark, schema migration level, record/object counts, the earliest
   source-retention deadline and a SHA-256 digest for every payload;
6. package and encrypt the logical snapshot, image payloads, post-export deletion
   evidence and manifest with the reviewed `age` v1 streaming format to an X25519
   recovery recipient. The authenticated manifest binds the ciphertext to its
   backup ID and intended object key. Plaintext and the private key never enter
   the storage provider;
7. upload only ciphertext to a separately controlled non-Cloudflare store with
   object lock/versioning. Use a write-only upload identity that cannot delete or
   shorten retention; an independent read-only verifier must fetch the object and
   verify decryptability, its manifest identity, size and every digest;
8. expire each recovery point at the earlier of 30 days after capture or the
   earliest source-retention deadline in its manifest. Retain its post-export
   deletion evidence for at least as long as every recovery point it protects;
9. alert only on a recorded run failure and recovery. A separate non-Cloudflare,
   non-Resend dead-man monitor must alert when no verified backup is newer than 36
   hours. Alerts contain no seller, listing, token, provider ID or message content.

Use separate least-privilege Cloudflare tokens for D1 export/query and Images
blob reads, without resource-delete permission, and rotate them independently of
the Pages/Worker credentials. The Cloudflare API may label D1 export permission
as write/edit even though this workflow never authorizes restore or deletion.
The backup runner must not receive production Pages or Worker deployment rights.
`GEAR_MAINTENANCE_STATE` is transient cursor/alert state and is deliberately not
part of disaster recovery.

If an attached image disappears during backup and the post-export deletion
evidence shows it was deleted, omit it and record the race. Any other missing
image fails the backup. The implementation must confirm the export's query-impact
behavior against current Cloudflare documentation and staging before scheduling.

Cloudflare D1 Time Travel is an additional short-term recovery layer, not the
off-provider backup. Current Cloudflare documentation gives production D1 a
plan-dependent 7- or 30-day Time Travel window. The external export exists for
account/provider loss and independently retained deletion evidence.

The rehearsal must restore into the isolated staging/recovery stack in its
separate Cloudflare account. Never restore over production to test a backup.
Rebuild a freshly migrated database from the logical snapshot, reconcile it against
the newer external deletion evidence, restore images as private objects, replace
provider IDs only through an audited mapping step, verify that excluded
sessions/links/tokens are absent, and run public/private projection checks before
allowing traffic. Record elapsed time and any manual steps. A database-only
restore is a failed rehearsal.

## Gate 2: isolated staging

Provision the entire disposable staging/recovery stack in its separate Cloudflare
account only after separate owner authorization:

- a separate Pages project and Access application;
- a new D1 database containing migrations `0001` through `0015` in order;
- a dedicated maintenance-state KV namespace;
- a private Images binding in a separate Cloudflare account from production,
  with its own account hash, variants and signing key;
- staging-only Turnstile, Resend and Cloudflare Access settings;
- staging `gear-images` and `gear-maintenance` Workers with preview URLs and
  public routes disabled;
- an allowlisted mail recipient and synthetic listings/images only.

No staging or recovery Worker with an `IMAGES` binding may exist in the production
Cloudflare account. Confirm at provisioning time that every Images binding is
scoped to the Worker account before enabling maintenance reconciliation.

Before any migration, capture the D1 bookmark and export. Apply each migration
once, verify the recorded migration level and run the D1/workerd contract checks.
Never point local harnesses or sample servers at staging or production bindings.

Exercise this matrix in staging:

- post, verify, recover/login, edit, close/relist and seller delete/recover;
- JPEG orientation/GPS/ICC/comment and PNG ancillary metadata sanitization;
- interrupted direct upload, finalize retry, removal and reorder;
- public browse and signed-photo expiry;
- buyer contact and reporting with Turnstile plus provider failures;
- Access allow/deny, report dismissal, removal and eligible/ineligible restore;
- due cleanup, outbox retry, orphan reconciliation, one-minute retry, one failure
  alert and one recovery alert;
- nightly encrypted export, independent read-back and full isolated restore.

No staging mail may leave the allowlist. No staging artifact may use a production
database, image ID, sender credential, signing key or backup prefix.
Pages Preview deployments must have no Gear bindings, values or secrets unless
they are explicitly connected only to these isolated staging resources.

## Gate 3: production configuration inventory

Pages requires these bindings/values, supplied through Cloudflare rather than
committed files:

| Name | Kind | Purpose |
|---|---|---|
| `GEAR_DB` | D1 binding | all Gear records |
| `GEAR_IMAGES` | service binding | private quarantine/sanitize/delete Worker |
| `GEAR_TURNSTILE_SITE_KEY` | public value | posting/report widget configuration |
| `GEAR_TURNSTILE_SECRET` | secret | server verification |
| `GEAR_RESEND_API_KEY` | secret | verification, recovery and buyer-contact mail |
| `GEAR_CONTACT_ENABLED` | value `true` | explicit buyer-contact launch switch |
| `GEAR_REPORTS_ENABLED` | value `true` | explicit report launch switch |
| `GEAR_PHOTO_UPLOADS_ENABLED` | value `true` | explicit upload launch switch |
| `GEAR_IMAGES_ACCOUNT_HASH` | value | signed delivery host path |
| `GEAR_IMAGES_PUBLIC_VARIANT` | value | approved public variant |
| `GEAR_IMAGES_SIGNING_KEY` | secret | short-lived delivery signatures |
| `GEAR_ACCESS_TEAM_DOMAIN` | value | exact Access issuer origin |
| `GEAR_ACCESS_AUD` | value | admin Access application audience |
| `GEAR_OWNER_EMAILS` | secret | exact comma-separated owner allowlist |

`gear-images` requires its `IMAGES` binding. `gear-maintenance` requires
`GEAR_DB`, `IMAGES`, dedicated `GEAR_MAINTENANCE_STATE`, `GEAR_RESEND_API_KEY`
and `GEAR_ALERT_RECIPIENT`. Complete copies of the example Worker configs remain
local/operator material until deployment is approved. Both Workers import shared
`lib/` modules, so a change to an imported module requires the affected Worker to
be reviewed and redeployed separately from Pages.

Verify the Resend sender domain for `gear@postandin.com`, including the provider's
required SPF/DKIM records, before testing any allowlisted staging delivery.

Create an Access application and policy covering all of
`gear-admin.postandin.com` before attaching that custom domain to the Pages
project. The policy must require the recorded identities and MFA. Because Pages
bindings are project/environment scoped rather than hostname scoped, verify the
outer Access denial before enabling the admin custom domain, then test denial for
unauthenticated and non-allowlisted identities across every `/api/gear/**` route
on that host. Finally verify the application's JWT/allowlist check.

Configure provider/edge rate limits for posting, verification and recovery,
contact, reports and photo upload. Turnstile and database counters complement
those limits; neither replaces the source-IP boundary. Confirm the chosen
Cloudflare plan can express every documented rule before launch approval.

## Gate 4: release candidate

From a clean canonical checkout at the exact proposed commit:

```bash
node --test tests/gear*.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-production-posting-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-production-contact-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-production-owner-check.mjs
git diff --check
```

These local commands must use only their synthetic fixtures and temporary
databases, never staging or production bindings. Capture versions and results in
the private release record. A failed or skipped required check is a no-go.

## Owner-approved deployment order

Only after an explicit deployment instruction:

1. create and verify the encrypted off-provider target with a synthetic canary;
2. provision production D1/KV/Images identities and capture the empty D1
   bookmark/export;
3. apply migrations `0001`–`0015` in order and verify schema/contracts;
4. deploy `gear-images` with no public route and verify it by service binding;
5. deploy `gear-maintenance`, verify its cron and execute one controlled run on
   synthetic production smoke data without sending an alert;
6. configure the Pages D1/service bindings, photo-delivery values and Access
   values, but leave both Turnstile values and all three `*_ENABLED` feature flags
   unset so `/api/gear/config` fails closed and public writes remain unavailable;
7. configure the admin hostname and Access policy, then verify outer denial before
   the Pages code is reachable;
8. deploy the reviewed Pages commit, verify owner allow/deny plus the application
   JWT/allowlist check, and run private/public smoke checks;
9. run and verify the first encrypted backup and isolated restore checkpoint;
10. set the Turnstile values and explicitly enable contact, reports and photo
    uploads, then repeat the public write smoke checks;
11. wait for the first scheduled backup after step 10 and verify its independent
    read-back, then add the homepage Gear card. Replace the broad `/gear/*`
    `noindex` rule and public-page meta directive while retaining `noindex` on the
    private owner page; update the sitemap/robots treatment, verify real 404s and
    purge only the affected Pages cache entries.

Steps 6–11 require a maintenance window because a push to the production branch
can deploy Pages. Stop at the first failed verification; do not continue hoping a
later step repairs it.

## Rollback and incident rules

- Pages rollback: redeploy the last known-good Pages commit. Do not reverse D1
  migrations destructively; the migrations are forward-only and older code must be
  assessed against the newer schema before rollback.
- Images Worker rollback: redeploy its last known-good Worker version. Preserve
  quarantine and deletion-outbox rows for retry.
- Maintenance rollback: disable the Cron Trigger, preserve D1/KV state, and
  redeploy the last known-good Worker. Do not delete cursor or failure-episode
  state except under its documented incident procedure.
- Suspected data corruption: disable public write feature flags and photo uploads,
  capture a fresh bookmark/export and external deletion evidence, then diagnose.
  Do not time-travel production or import a backup without a separately approved
  restore plan.
- Mail incident: disable the affected feature flag or remove the mail credential;
  never substitute a success response when delivery is unconfirmed.
- Access incident: remove usable admin bindings or deny the Access application;
  do not rely solely on hiding the owner page.

After rollback, public reads must still exclude expired, unverified, closed,
removed and seller-deleted listings. Never restore a record or image until newer
deletion evidence has been reconciled.

## Final go-live evidence

The private release record must contain the exact commit, resource names/IDs,
migration results, configuration checklist without secret values, Access policy
screenshots, edge-rule verification, mail allowlist result, image metadata result,
maintenance result, backup object/digest, restore-rehearsal result, smoke-test
results, rollback targets and the owner's explicit go-live approval.

No single source-only review or passing local suite constitutes deployment or
go-live approval.

## Platform references

Last checked: 2026-09-30.

- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 SQL export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)
- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Cloudflare Images export](https://developers.cloudflare.com/images/storage/manage-images/export-images/)
