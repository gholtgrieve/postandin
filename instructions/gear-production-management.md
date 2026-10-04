# Gear Exchange production seller management sessions

Status: production Pages routes and D1 binding are deployed. Production mail and
Turnstile are configured for the go-live deployment, and the owner-approved
combined Free-plan edge rule is Active for seller recovery and other public
writes. Tests use temporary sample databases and mocked provider responses; no
production seller or management session exists. The reviewed go-live deployment
and smoke test remain.

## Credential flow and listing routes

All six seller-management endpoints described here are POST-only and require the exact
`https://postandin.com` URL origin and browser `Origin` header. The listing-write
route accepts at most 24 KiB of fatal UTF-8 JSON so every valid bounded Unicode
listing fits; the others accept at most 1 KiB.
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
   seller and creates a fresh 30-day session transactionally. The response sets
   `__Host-gear_session` with `Secure; HttpOnly; SameSite=Strict; Path=/` and no
   Domain, and returns only the derived CSRF value and original expiry.
4. `POST /api/gear/management/session` requires exactly one host-only session
   cookie and returns the same derived CSRF value plus original expiry. It creates
   no session, sets no cookie and never extends expiry.
5. `POST /api/gear/management/logout` additionally requires `X-Gear-CSRF`, revokes
   the live session and clears the cookie with `Max-Age=0`.
6. `POST /api/gear/management/listings` accepts exactly `{}` and requires the
   live host-only session. One D1 batch returns up to 100 verified owner listings
   that are not in seller-deletion recovery, including owner-moderated removed
   listings, plus their ordered photos as ten-minute signed URLs. The same
   snapshot includes a separate bounded seller-deletion list containing only
   listing ID, title and deletion dates. Past-deadline rows remain visible as
   awaiting cleanup; the UI must offer recovery only while `purgeAt` is future.
   Seller email/ID and standalone image provider IDs never enter the response.
7. `POST /api/gear/management/listing` requires the live session and matching
   `X-Gear-CSRF`. It accepts either an exact `{id,action}` state mutation or
   `{id,action:"edit",listing}`. Existing D1 adapters recheck ownership, session,
   CSRF, verification, status, expiry, duplicate and active-listing rules inside
   each write. Validation errors return bounded field messages; stale or rejected
   writes return a generic conflict.

The static browser module now activates the production management adapter only
when `location.origin` is exactly `https://postandin.com`; loopback connected mode
and the ordinary static demo remain separate. It reads `#management=` once,
immediately removes the whole fragment with `history.replaceState`, and then
explicitly POSTs the strict 64-character token. Existing cookies recover through
the session route when the seller opens Manage; an ordinary production page load
makes no anonymous session request. The UI supports generic recovery requests, logout, the
transactional management snapshot, listing edits/status changes, seller
delete/recover and the reviewed photo routes. It never stores a CSRF value or
credential persistently; each mutation first recovers the current CSRF value.
New-listing publication and verified email changes remain unavailable in
production mode instead of falling through to preview simulations. Buyer contact
and reporting also stay disabled until their production UI increments. The
hard-coded browse examples remain clearly labelled as sample listings at every
viewport, and their relative ages are suppressed on the production origin.

Expired, replayed, revoked, wrong-mailbox and malformed credentials fail without
issuing access. Raw tokens, sessions and CSRF values are never stored in D1.

## Delivery and abuse boundary

`GEAR_RESEND_API_KEY` is an environment-only secret. Provider calls have a
10-second timeout, do not follow redirects, require a successful bounded response shape
and expose only a generic error to application callers. Delivery runs under the
Pages request lifetime. A provider failure is logged server-side but deliberately
does not change the public 202 response, which avoids disclosing whether an email
belongs to a verified seller. Delivery is capped at five messages per seller in
each anchored 24-hour window. Within that cap, while the previous link remains unconsumed, a
request made less than 60 seconds later for the same seller returns the same
generic response without replacing the link or sending mail. At the cooldown
boundary, a later request safely replaces the previous link; a seller who has
consumed the prior link may request a new one immediately.

Because the public recovery response must not reveal whether an email belongs to
a seller, anyone who knows a seller's address can consume that address's five
delivery attempts and delay further recovery mail until its anchored window ends.
An existing 30-day management session continues to work. If the owner confirms a
legitimate seller is locked out, inspect that seller's recovery row and reset it
by deleting the matching `gear_management_links` row; record the intervention and
never disclose whether a row existed to an unverified requester. The combined
source-IP edge rule reduces single-source abuse but does not replace this
per-seller limit.

Do not deploy these routes until the owner has explicitly authorized deployment
and the recovery endpoint has the combined Cloudflare source-IP rule plus the
D1-backed 60-second per-seller cooldown and five-per-24-hour cap. Staging must verify the Resend
sender and secret without exercising this production-host-only flow. End-to-end
cookie, delivery and logout validation must run on `postandin.com` behind a
temporary owner-only gate while the public UI remains unlinked; a separate
staging origin would require an explicit code/configuration change. The management
UI removes the token fragment with `history.replaceState` immediately after
reading it. Logs use only non-sensitive delivery reason codes and must contain no
credential or recipient. This slice does not add retries; retry
and failure-only operational alerts belong to the separately approved maintenance
work so a provider outage cannot create mail loops.

## Verification

```bash
node --test tests/gearProductionManagementUI.test.mjs tests/gearPagesManagementSession.test.mjs tests/gearPagesManagementListings.test.mjs tests/gearPagesSellerDeletion.test.mjs tests/gearManagement.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
git diff --check
```

Focused tests cover exact request boundaries, generic known/unknown/failure
responses, provider request shape and failures, POST-only confirmation, one-use
tokens, host-only cookies, stable reload recovery, logout revocation, missing and
duplicate cookies, generic public errors and the full temporary-database session
lifecycle. The D1/workerd harness uses the production issue/redeem/recovery core
plus managed photo/deletion projections, and a local-only outbound-service probe
verifies the Workers redirect option.
