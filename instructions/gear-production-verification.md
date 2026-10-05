# Gear production posting and email verification

Status: backend and browser flow are live with production D1. Turnstile, Resend
and the owner-approved combined Free-plan edge rule are Active. The reviewed
go-live deployment and production smoke checks passed; the production database
was empty at the recorded post-deploy inspection. The automatic
post-verification management-email change described below deploys with the Pages
merge after migration 0020 is applied.

## Request flow

All posting endpoints accept bounded JSON only from the exact
`https://postandin.com` origin and return `Cache-Control: no-store` plus a
no-referrer policy.

1. `POST /api/gear/drafts` accepts `{listing, turnstileToken}`. It validates the
   full listing, verifies the single-use Turnstile token server-side for hostname
   `postandin.com` and action `gear-post`, and only then creates an unverified D1
   draft. It returns the random draft UUID, never a verification credential.
2. `POST /api/gear/drafts/update` accepts the draft UUID, its separate
   listing-scoped draft token and a complete validated listing. It preserves the
   private draft ID, invalidates any previously issued verification link and
   allows the Details screen to be corrected during the three-day draft lifetime.
3. `POST /api/gear/drafts/photos/upload` and
   `POST /api/gear/drafts/photos/finalize` accept that same scoped draft token,
   attach sanitized private photos and return the attached photo ID. The scoped
   `POST /api/gear/drafts/photos/remove` and
   `POST /api/gear/drafts/photos/reorder` routes persist what the Photos and
   Review screens show before publication. Removal is idempotent, and reorder
   treats the browser's ordered photo-ID subset (including an empty list) as the
   authoritative state, removing server photos omitted from that list.
4. `POST /api/gear/verification/request` accepts that UUID. The UUID is a
   temporary capability to replace the draft's 30-minute verification token and
   send it only to the email already stored for that draft. It cannot choose or
   reveal the recipient. Source enforces a one-minute cooldown and five-message
   cap per draft, even if the seller corrects the draft email address; editing
   invalidates an issued link without resetting that cap. A provider/configuration failure returns 503 and says the
   three-day draft remains saved for retry; it never claims delivery. Missing
   configuration does not rotate a prior token. A definite pre-delivery rejection
   invalidates its unsent token and releases that attempt's count and cooldown;
   ambiguous network, 5xx or post-acceptance failures keep the token, count and
   cooldown reserved. A token-hash guard cannot roll back a newer issuance.
5. The email link is
   `https://postandin.com/gear/#verification=<64-hex-token>`. The browser
   must read and erase the fragment synchronously. Opening the link is inert.
   `POST /api/gear/verification/confirm` requires `{token, confirm:true}` and is
   the only production action that can publish. A newly committed publication
   then issues and sends a durable, listing-scoped management link to the
   verified seller address. A safe replay of the committed verification response
   does not issue or send another management link.

The database stores only a SHA-256 token hash. Migration 14 records a bounded
production issue count; existing token rows begin at one. Reissue replaces the
prior token. Confirmation is one-use at the state-transition boundary, expires
after 30 minutes, safely acknowledges retry after a committed response was lost,
and atomically rechecks draft
state, seller/email consistency, the ten-active-listing limit and live duplicate
rules. Success verifies the seller and publishes only that one draft. It does not
create a management session. Instead, it automatically emails the separate
management credential; the seller must explicitly open it and choose **Continue** to
create a 30-day browser session limited to that listing. The hash-only credential
remains reusable while that listing is available, pending, closed, expired, or
within its 30-day seller-deletion recovery period. Issuance is constrained to the listing published at the exact
confirmation timestamp and never accepts an email from the browser. It is stored
separately from one-use seller-wide recovery links and does not consume their
delivery limit. Permanent deletion cascades the credential; verified email
transfer deletes it, and owner moderation permanently deletes it and revokes its
live listing-scoped sessions. Restoration does not reissue it. A
provider or issuance failure cannot roll back publication and is logged without
recipient, token, or provider details; the seller can request temporary
seller-wide access from **Manage my listings**.
Both issuance and confirmation enforce the three-day draft deadline even when
scheduled cleanup is delayed. Maintenance keeps an expired unconsumed token row
for a still-live draft so the durable delivery count cannot reset; the eventual
draft purge removes it by cascade. Consumed rows remain only through token expiry
so a lost success response can be acknowledged.

## Browser flow and public configuration

Production behavior activates only at exact origin `https://postandin.com`.
`GET /api/gear/config` returns only the public `GEAR_TURNSTILE_SITE_KEY`, with
no-store, no-referrer and nosniff headers. It fails closed when the key is absent
or invalid. New-listing controls remain unavailable in that state, but emailed
verification confirmation continues to work.

When configured, the browser loads Cloudflare's exact
`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` script,
renders a flexible-width widget with action `gear-post`, and enables a new draft
only after its callback provides a bounded token. The token is sent only in the
JSON draft request and the widget is reset after every draft attempt. Error and
expiry callbacks clear the token while Turnstile owns its automatic retry and
refresh. An already-created unchanged draft ID is kept in memory when email
delivery fails, so the verification-screen resend button requests another
message without another draft or Turnstile solve. Editing the form updates that
same private draft through its scoped token, invalidates any older verification
link and requires a newly delivered link for the revised content. If the draft
expires, the browser keeps the entered details and selected local photos, returns
to Details and requests a new privacy check.

The browser reads a strict `#verification=<64-hex-token>` fragment and erases it
synchronously before any awaited import or network work. It never auto-publishes:
the user must choose **Publish listing**, which sends the token in a no-referrer
JSON POST. After a successful new publication, the browser tells the seller to
check for the automatic management email, save it for future management, and
request a temporary access link if it does not arrive. An already-committed replay directs the seller
to the prior management email or the recovery form. The local connected preview and
ordinary inert demo retain their existing behavior. Recognized malformed links
show a generic invalid-link message, and same-document verification navigation
uses the same read-and-erase confirmation flow.

## Provider boundary

The verification and management Resend adapters use the fixed sender
`Post & In Gear <gear@postandin.com>`, plain-text messages, manual redirect
handling, and ten-second timeouts. The automatic management email explains that
its saved link works while that listing is available, pending, closed, expired,
or within seller-deletion recovery, that choosing **Continue** starts a 30-day
session limited to the listing, replaces any current Gear management session in
that browser, and signs out any other device using the link, and that the seller
can edit details, manage photos, change availability, renew or relist eligible
gear, and remove or recover it. It warns the seller not to forward the bearer
link and identifies the revocation conditions. The separate seller-wide recovery
message remains one-use and expires after 30 minutes. The verification adapter additionally uses a 4 KiB response
limit and a
token-hash-derived idempotency key. It accepts only a successful JSON response
containing a UUID. Errors expose only a bounded internal code to logs; logs never
include the address, raw token, provider body or API key.

## Abuse and launch gates

Before launch, provision and verify:

- separate staging and production D1/Turnstile/Resend configuration;
- a production-host-restricted Turnstile widget and matching secret;
- the owner-approved combined Free-plan edge rule documented in the launch
  runbook, covering draft creation and verification delivery (Turnstile does not
  replace rate limits);
- Resend sender/domain authorization and allowlisted staging recipients;
- production-origin browser checks at phone and desktop sizes, including lost
  responses, reissue, expiry, replay, quota and duplicate conflicts;
- the already-approved three-day unverified-draft cleanup and failure alerting.

No real provider call is permitted in repository tests. Unit tests inject local
provider responses, and database checks use temporary sample storage only.
The isolated production browser harness intercepts every API and Turnstile
request; it does not contact providers or production resources. It covers an
HTML edge 429 with Retry-After, saved-draft resend, verification/delivery mode
isolation, click-during-config state restoration, same-tab verification-token
races, a 300 px Turnstile stand-in at 320 px, and the missing-config gate.

## Local verification

Run focused checks from the canonical checkout:

```bash
node --test tests/gearPagesVerification.test.mjs tests/gearVerification.test.mjs tests/gearProductionMaintenance.test.mjs tests/gearPagesReportSubmission.test.mjs
node --test tests/gearProductionPostingUI.test.mjs tests/gearProductionManagementUI.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-production-posting-check.mjs
node --check lib/gear-verification.mjs
node --check lib/gear-verification-mail.mjs
node --check lib/gear-turnstile.mjs
node --check functions/api/gear/drafts.js
node --check functions/api/gear/drafts/update.js
node --check functions/api/gear/drafts/photos/remove.js
node --check functions/api/gear/drafts/photos/reorder.js
node --check functions/api/gear/verification/request.js
node --check functions/api/gear/verification/confirm.js
```
