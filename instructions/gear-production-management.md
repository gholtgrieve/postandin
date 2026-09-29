# Gear Exchange production seller management sessions

Status: source-only and not deployed. No D1 binding, Resend API key, sender-domain
configuration, edge rate limit, UI connection or production route has been
provisioned. Tests use temporary sample databases and mocked provider responses;
no real email or production record was used.

## Credential flow

All four endpoints are POST-only, accept at most 1 KiB of fatal UTF-8 JSON and
require the exact `https://postandin.com` URL origin and browser `Origin` header.
Responses are JSON with `no-store`, `no-referrer` and `nosniff` headers.

1. `POST /api/gear/management/recovery` validates and normalizes an email. A
   verified seller gets a new 256-bit, 30-minute, one-use link token stored only
   as SHA-256. Known and unknown addresses receive the same generic 202 body. The
   public response never includes the token, recipient or provider result.
2. The delivery adapter submits a plain-text email to Resend from
   `Post & In Gear <gear@postandin.com>`. Its idempotency key contains only a
   SHA-256 token digest. The management token is placed after `#management=` in
   the Post & In URL, keeping it out of the HTTP request URL and Referrer header.
   Opening the link performs no write.
3. `POST /api/gear/management/confirm` requires the token and `confirm:true`.
   Successful redemption consumes the token, revokes prior sessions for that
   seller and creates a fresh 24-hour session transactionally. The response sets
   `__Host-gear_session` with `Secure; HttpOnly; SameSite=Strict; Path=/` and no
   Domain, and returns only the derived CSRF value and original expiry.
4. `POST /api/gear/management/session` requires exactly one host-only session
   cookie and returns the same derived CSRF value plus original expiry. It creates
   no session, sets no cookie and never extends expiry.
5. `POST /api/gear/management/logout` additionally requires `X-Gear-CSRF`, revokes
   the live session and clears the cookie with `Max-Age=0`.

Expired, replayed, revoked, wrong-mailbox and malformed credentials fail without
issuing access. Raw tokens, sessions and CSRF values are never stored in D1.

## Delivery and abuse boundary

`GEAR_RESEND_API_KEY` is an environment-only secret. Provider calls have a
10-second timeout, do not follow redirects, require a successful bounded response shape
and expose only a generic error to application callers. Delivery runs under the
Pages request lifetime. A provider failure is logged server-side but deliberately
does not change the public 202 response, which avoids disclosing whether an email
belongs to a verified seller. A later request safely replaces the previous link.

Do not connect the UI or deploy these routes until the owner has explicitly
authorized deployment and the recovery endpoint has Cloudflare edge controls for
per-IP and per-recipient throttling plus bot abuse. Staging must verify the Resend
sender and secret without exercising this production-host-only flow. End-to-end
cookie, delivery and logout validation must run on `postandin.com` behind a
temporary owner-only gate while the public UI remains disconnected; a separate
staging origin would require an explicit code/configuration change. The management
UI must remove the token fragment with `history.replaceState` immediately after
reading it. Logs use only non-sensitive delivery reason codes and must contain no
credential or recipient. This slice does not add retries; retry
and failure-only operational alerts belong to the separately approved maintenance
work so a provider outage cannot create mail loops.

## Verification

```bash
node --test tests/gearPagesManagementSession.test.mjs tests/gearPagesSellerDeletion.test.mjs tests/gearManagement.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
git diff --check
```

Focused tests cover exact request boundaries, generic known/unknown/failure
responses, provider request shape and failures, POST-only confirmation, one-use
tokens, host-only cookies, stable reload recovery, logout revocation, missing and
duplicate cookies, generic public errors and the full temporary-database session
lifecycle. The D1/workerd harness uses the production issue/redeem/recovery core
and a local-only outbound-service probe verifies the Workers redirect option.
