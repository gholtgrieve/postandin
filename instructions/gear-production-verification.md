# Gear production posting and email verification

Status: backend and browser flow are deployed with production D1. Turnstile and
Resend are configured for the go-live deployment, and the owner-approved combined
Free-plan edge rule is Active. No production listing or real production
verification mail exists; the reviewed go-live deployment and smoke test remain.

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
   `https://postandin.com/gear/#verification=<64-hex-token>`. A browser increment
   must read and erase the fragment synchronously. Opening the link is inert.
   `POST /api/gear/verification/confirm` requires `{token, confirm:true}` and is
   the only production action that can publish.

The database stores only a SHA-256 token hash. Migration 14 records a bounded
production issue count; existing token rows begin at one. Reissue replaces the
prior token. Confirmation is one-use at the state-transition boundary, expires
after 30 minutes, safely acknowledges retry after a committed response was lost,
and atomically rechecks draft
state, seller/email consistency, the ten-active-listing limit and live duplicate
rules. Success verifies the seller and publishes only that one draft. It does not
create a management session; the seller requests a separate management link.
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
JSON POST. A successful confirmation does not create a management session; the
seller requests a separate management link. The local connected preview and
ordinary inert demo retain their existing behavior. Recognized malformed links
show a generic invalid-link message, and same-document verification navigation
uses the same read-and-erase confirmation flow.

## Provider boundary

The Resend adapter uses the fixed sender `Post & In Gear <gear@postandin.com>`, a
plain-text message, manual redirect handling, a ten-second whole-response timeout,
a 4 KiB response limit and a
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
