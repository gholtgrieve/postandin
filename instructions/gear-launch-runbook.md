# Gear Exchange launch and rollback runbook

Status: active launch plan. The owner authorized isolated staging setup. A
staging-only D1 database and maintenance-state KV namespace now exist; the empty
D1 bookmark/export was captured, migrations `0001`–`0015` applied in order and
the expected 18 empty Gear tables were verified. Migrations `0016`–`0018` are
pending and must be applied before the matching Pages code. The isolated staging Pages
project is deployed behind an owner-only Cloudflare Access application with
independent MFA on the canonical, admin and wildcard deployment hostnames.
Authenticated empty public browse and private owner-dashboard reads passed.
Staging mail, image writes, maintenance Worker, backup schedule and every
production resource remain undeployed. Production still requires separate
explicit approval.

## Release boundary

Gear has four independently released surfaces:

1. the existing Pages project (`functions/api/gear/**` and `/gear/**`);
2. the service-binding-only `postandin-gear-images` Worker (`gear-images/`);
3. the cron-only `postandin-gear-maintenance` Worker (`gear-maintenance/`);
4. an external, non-Cloudflare backup runner.

A Git push can deploy Pages. It does not deploy either Worker and must never be
treated as doing so. The backup runner uses a dedicated account-scoped D1 API
token for the production Cloudflare account, but must not share the B2 storage
account or encryption-key custody it is intended to protect.

## Decisions required before provisioning

Record these in the private operator record, not in Git:

- exact owner identities and identity provider for Cloudflare Access, with MFA;
- maintenance failure/recovery alert recipient;
- Backblaze B2 billing owner and GitHub Actions repository owner;
- encryption-key custodian and a second person/location holding a recovery copy;
- the Cloudflare plan/rules available for the required per-IP edge limits;
- separate staging and production names for D1, maintenance KV and Access.

Do not put account IDs, database IDs, access audiences, owner emails, API tokens,
signing keys or backup keys in this repository.

## Gate 1: backup and recovery first

Do not enable public writes until a complete recovery rehearsal passes.

The approved lean nightly job runs in GitHub Actions at 08:00 UTC, away from the
11:00 UTC maintenance window, and:

1. request a table-filtered D1 SQL export through the polling export API and
   retain its time-travel bookmark on the external runner only;
2. load that transient export into an isolated local SQLite process and create a
   records-only snapshot containing non-draft, non-seller-deleted listings plus
   their sellers/clubs, generic owner-removal state and active minimal deletion
   evidence. Exclude photos/provider IDs, credentials, contact data,
   reports/history, counters, quarantines and deletion work. Discard the raw SQL
   and close the ephemeral database immediately after packaging;
3. query the current active deletion ledger again after the snapshot, so a restore
   cannot resurrect a seller purge that completed after the database snapshot;
4. encrypt the versioned JSON snapshot with `age` to an offline-held X25519
   identity; only its public recipient is available to GitHub;
5. upload only ciphertext to a private B2 bucket using a one-bucket, prefix-scoped
   key with exactly `readFiles` and `writeFiles`. `writeFiles` can hide objects,
   so the lean backup is not immutable and a stolen key can cause backup loss;
6. download the ciphertext by file ID and verify it byte-for-byte;
7. rely on a reviewed B2 lifecycle rule to permanently remove current and prior
   object versions after 30 days. Object Lock is intentionally not enabled.

Use a dedicated account-scoped Cloudflare D1 token for export/query and rotate it
independently of the Pages/Worker credentials. Try D1 Read during setup; if export
requires D1 Edit, explicitly record that the GitHub secret can write any D1
database in the account. The workflow itself never authorizes restore or deletion.
The backup runner must not receive production Pages or Worker deployment rights.
`GEAR_MAINTENANCE_STATE` is transient cursor/alert state and is deliberately not
part of disaster recovery.

Cloudflare's export API makes the D1 database unavailable to queries while an
export runs. Keep the 08:00 UTC low-traffic schedule, measure the interruption
in staging and do not activate the schedule if it is operationally unacceptable.

Cloudflare D1 Time Travel is an additional short-term recovery layer, not the
off-provider backup. Current Cloudflare documentation gives production D1 a
plan-dependent 7- or 30-day Time Travel window. The external export exists for
account/provider loss and independently retained deletion evidence.

The rehearsal restores into a new temporary/local database. Never restore over
production to test a backup. Rebuild a freshly migrated database from the logical
snapshot, reconcile any newer backup's deletion evidence, verify excluded
credentials/contact/reports/photos are absent, and run public/private projection
checks. Record elapsed time and manual steps. See `gear-lean-backup.md`.

## Gate 2: isolated staging

Provision disposable staging records/auth resources only after separate owner
authorization:

- a separate Pages project and Access application;
- a new D1 database containing migrations `0001` through `0018` in order;
- a dedicated maintenance-state KV namespace;
- staging-only Turnstile, Resend and Cloudflare Access settings;
- an allowlisted mail recipient and synthetic records only.

The D1, maintenance KV, Pages and Access bullets are complete. The staging public
origin is `https://postandin-gear-staging.pages.dev`; the Access-protected admin
origin is `https://gear-admin-staging.postandin.com`. Server configuration sets
`GEAR_PUBLIC_ORIGIN` and `GEAR_ADMIN_ORIGIN` to those exact allowlisted values;
an unset value retains the production origin and any other value fails closed.
The Pages project also has a staging-only random photo-signing secret and
syntactically valid placeholder delivery values so an empty public listing read
can run without an Images binding. Those placeholders are not valid for photo
testing and no image object has been uploaded.

The staging public host, admin custom hostname and wildcard Pages deployment
hostnames are protected by one temporary Cloudflare Access application limited
to the approved owner identity. Independent MFA enrollment and authenticated
access were verified, as were anonymous redirects on the public page, public API
and one deployment-specific hostname. Do not bind the staging Resend key until
its recipient allowlist is configured. This keeps draft verification, management
and buyer-contact mail under trusted tester control and satisfies the staging
rule that no mail may leave the approved test group. Production remains public
and does not use this temporary staging policy.

The lean plan does not create a second Images account. Do not deploy a staging
maintenance Worker against production Images: orphan reconciliation would treat
production objects as absent from staging D1. Continue to test Images and
maintenance with workerd/mocked bindings, then use a few disposable private
canary images during the owner-approved production release window.

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
- nightly encrypted records export, B2 read-back and isolated records restore.

Observed October 1, 2026: the protected staging site completed synthetic post,
email verification, management-link login, seller deletion and seller recovery.
The first recovery attempt exposed a browser action-name mismatch (`restore`
versus the production route's `recover`); the corrected client was covered by a
regression test, redeployed to isolated staging and then completed recovery. The
disposable listing was deleted again, and a read-only D1 query confirmed its
`removed` status and active recovery marker. A later live pass recovered that
same disposable listing, saved a title edit through the full three-step form,
closed it, relisted it for 30 days, and deleted it again. The staging UI
confirmed each write and ended with zero active listings plus a fresh 30-day
recovery deadline. Independent Access MFA was also recovered after deleting an
inaccessible authenticator and enrolling a replacement TOTP device; the test
Mac/browser did not offer a usable platform biometric authenticator.

A subsequent allowlisted staging pass enabled buyer contact and reports. The
buyer-contact message reached the approved recipient, although the browser
received an indeterminate delivery response and exposed the preserved-request
retry state after delivery; simplifying that ambiguous state is recorded as a
pre-launch UI requirement. A synthetic “Spam or suspicious activity” report
appeared in the Access-protected owner queue, and the owner dismissed it with a
recorded reason. The disposable listing was then seller-deleted again, leaving
zero active test listings and the normal 30-day recovery record. No staging mail
was sent outside the configured allowlist, and no production resource was used.

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
| `GEAR_PUBLIC_ORIGIN` | value | exact public request/mail-link origin; unset means production |
| `GEAR_ADMIN_ORIGIN` | value | exact Access-protected admin origin; unset means production |
| `GEAR_IMAGES` | service binding | private quarantine/sanitize/delete Worker |
| `GEAR_TURNSTILE_SITE_KEY` | public value | posting/report widget configuration |
| `GEAR_TURNSTILE_SECRET` | secret | server verification |
| `GEAR_RESEND_API_KEY` | secret | verification, recovery and buyer-contact mail |
| `GEAR_STAGING_MAIL_RECIPIENTS` | staging-only secret | exact comma-separated staging delivery allowlist; required with the staging public origin |
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

The staging Pages project must set `GEAR_STAGING_MAIL_RECIPIENTS` before its
Resend key is bound; every verification, recovery and buyer-contact delivery
then fails closed unless its actual recipient is in that exact allowlist.
Production does not set this staging-only value. Verify the Resend sender domain
for `gear@postandin.com`, including the provider's
required SPF/DKIM records, before testing any allowlisted staging delivery.
Enter each staging allowlist address once, with no trailing comma, embedded
spaces or trailing newline; a malformed secret safely disables staging mail.

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

1. create the private B2 bucket/lifecycle/key, offline `age` identity and inactive
   GitHub workflow, then verify the target with a synthetic canary;
2. provision production D1/KV/Images identities and capture the empty D1
   bookmark/export;
3. apply migrations `0001`–`0018` in order and verify schema/contracts;
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
9. manually run and verify the first encrypted records backup and local restore
   checkpoint, accepting that photos are not covered;
10. confirm the public privacy copy discloses the encrypted off-provider B2/GitHub
    backup and its approximate retention, set the Turnstile values and explicitly
    enable contact, reports and photo uploads, then repeat the public write smoke
    checks;
11. enable the nightly schedule, wait for its first successful B2 read-back, then
    add the homepage Gear card. Replace the broad `/gear/*`
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
maintenance result, encrypted records object/read-back, photo-loss acceptance,
restore-rehearsal result, smoke-test
results, rollback targets and the owner's explicit go-live approval.

No single source-only review or passing local suite constitutes deployment or
go-live approval.

## Platform references

Last checked: 2026-09-30.

- [D1 Time Travel and backups](https://developers.cloudflare.com/d1/reference/time-travel/)
- [D1 SQL export API](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/)
- [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/)
- [Backblaze B2 Native API](https://www.backblaze.com/docs/cloud-storage-apis)
