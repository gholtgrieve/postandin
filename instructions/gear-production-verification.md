# Gear production posting and email verification

Status: source-only backend foundation, not deployed. No D1 binding, Turnstile
widget/site key or secret, Resend key, edge rule, production data or real mail was
created or used.

## Request flow

All three endpoints accept bounded JSON only from the exact
`https://postandin.com` origin and return `Cache-Control: no-store` plus a
no-referrer policy.

1. `POST /api/gear/drafts` accepts `{listing, turnstileToken}`. It validates the
   full listing, verifies the single-use Turnstile token server-side for hostname
   `postandin.com` and action `gear-post`, and only then creates an unverified D1
   draft. It returns the random draft UUID, never a verification credential.
2. `POST /api/gear/verification/request` accepts that UUID. The UUID is a
   temporary capability to replace the draft's 30-minute verification token and
   send it only to the email already stored for that draft. It cannot choose or
   reveal the recipient. Source enforces a one-minute cooldown and five-message
   cap per draft. A provider/configuration failure returns 503 and says the
   three-day draft remains saved for retry; it never claims delivery. Missing
   configuration does not rotate a prior token. A definite pre-delivery rejection
   invalidates its unsent token and releases that attempt's count and cooldown;
   ambiguous network, 5xx or post-acceptance failures keep the token, count and
   cooldown reserved. A token-hash guard cannot roll back a newer issuance.
3. The email link is
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

## Provider boundary

The Resend adapter uses the fixed sender `Post & In Gear <gear@postandin.com>`, a
plain-text message, manual redirect handling, a ten-second whole-response timeout,
a 4 KiB response limit and a
token-hash-derived idempotency key. It accepts only a successful JSON response
containing a UUID. Errors expose only a bounded internal code to logs; logs never
include the address, raw token, provider body or API key.

## Abuse and launch gates

The browser must not be connected until it can acquire a production Turnstile
token for `gear-post`. Before launch, provision and verify:

- separate staging and production D1/Turnstile/Resend configuration;
- a production-host-restricted Turnstile widget and matching secret;
- Cloudflare edge limits for draft creation and verification delivery, with the
  final thresholds documented and tested (Turnstile does not replace rate limits);
- Resend sender/domain authorization and allowlisted staging recipients;
- production-origin browser checks at phone and desktop sizes, including lost
  responses, reissue, expiry, replay, quota and duplicate conflicts;
- the already-approved three-day unverified-draft cleanup and failure alerting.

No real provider call is permitted in repository tests. Unit tests inject local
provider responses, and database checks use temporary sample storage only.

## Local verification

Run focused checks from the canonical checkout:

```bash
node --test tests/gearPagesVerification.test.mjs tests/gearVerification.test.mjs tests/gearProductionMaintenance.test.mjs tests/gearPagesReportSubmission.test.mjs
node --check lib/gear-verification.mjs
node --check lib/gear-verification-mail.mjs
node --check lib/gear-turnstile.mjs
node --check functions/api/gear/drafts.js
node --check functions/api/gear/verification/request.js
node --check functions/api/gear/verification/confirm.js
```
