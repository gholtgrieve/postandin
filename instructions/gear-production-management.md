# Gear Exchange production seller management sessions

Status: production Pages routes, D1 binding, mail, Turnstile and the
owner-approved combined Free-plan edge rule are live. The reviewed go-live
deployment and production smoke checks passed. Tests continue to use temporary
sample databases and mocked provider responses; the production database was
empty at the recorded post-deploy inspection. The automatic
post-verification management-email change described below deploys with the Pages
merge after migration 0020 is applied.

## Credential flow and listing routes

The six seller-management endpoints plus the post-verification handoff described here are POST-only and require the exact
`https://postandin.com` URL origin and browser `Origin` header. The listing-write
route accepts at most 24 KiB of fatal UTF-8 JSON so every valid bounded Unicode
listing fits; the others accept at most 1 KiB.
Responses are JSON with `no-store`, `no-referrer` and `nosniff` headers.

1. A newly committed `POST /api/gear/verification/confirm` publication
   automatically creates a 256-bit durable management link for that listing's
   verified seller. Issuance is keyed to the listing ID and exact verification
   timestamp, never a client-provided address. The raw token is emailed once and
   stored only as SHA-256; a safely replayed verification response does not issue
   or send another link.
2. `POST /api/gear/management/recovery` validates and normalizes an email. A
   verified seller gets a new 256-bit, 30-minute, one-use link token stored only
   as SHA-256. Known and unknown addresses receive the same generic 202 body. The
   public response never includes the token, recipient or provider result.
3. The shared delivery adapter submits a plain-text email to Resend from
   `Post & In Gear <gear@postandin.com>`. Its idempotency key contains only a
   SHA-256 token digest. The management token is placed after `#management=` in
   the Post & In URL, keeping it out of the HTTP request URL and Referrer header.
   Opening the link performs no write; the seller must choose **Continue** before
   the browser redeems it. Because durable and temporary links share this fragment,
   the pre-confirmation screen is scope-neutral. It warns that continuing replaces
   any current Gear management session in that browser and may sign out another
   device already managing the same listings. Automatic post-verification mail asks the
   seller to save the email, explains that its link works while that listing is
   available, pending, closed, expired, or within seller-deletion recovery, warns against forwarding it, and lists the available
   actions. Recovery mail instead explains its 30-minute, one-use boundary.
4. `POST /api/gear/management/confirm` requires the token and `confirm:true`.
   A recovery-token redemption consumes the token, revokes prior sessions for
   that seller, and creates a fresh seller-wide 30-day session transactionally.
   A durable listing-token redemption leaves the token reusable, revokes only a
   prior session for the same listing, and creates a fresh 30-day session scoped
   to that listing. The response sets
   `__Host-gear_session` with `Secure; HttpOnly; SameSite=Strict; Path=/` and no
   Domain, and returns only the derived CSRF value and original expiry.
5. `POST /api/gear/management/session` requires exactly one host-only session
   cookie and returns the same derived CSRF value plus original expiry. It creates
   no session, sets no cookie and never extends expiry.
6. `POST /api/gear/management/logout` additionally requires `X-Gear-CSRF`, revokes
   the live session and clears the cookie with `Max-Age=0`.
7. `POST /api/gear/management/listings` accepts exactly `{}` and requires the
   live host-only session. Its response names the effective credential scope as
   `scope: "seller"` or `scope: "listing"`. One D1 batch returns up to 100 verified owner listings
   that are not in seller-deletion recovery, including owner-moderated removed
   listings, plus their ordered photos as ten-minute signed URLs. The same
   snapshot includes a separate bounded seller-deletion list containing only
   listing ID, title and deletion dates. Past-deadline rows remain visible as
   awaiting cleanup; the UI must offer recovery only while `purgeAt` is future.
   Seller email/ID and standalone image provider IDs never enter the response. A
   listing-scoped session returns only its listing and corresponding recovery row.
   The UI replaces the seller-wide active count with a narrower-scope label, hides
   the new-listing controls, and keeps temporary seller-wide recovery available.
8. `POST /api/gear/management/listing` requires the live session and matching
   `X-Gear-CSRF`. It accepts either an exact `{id,action}` state mutation or
   `{id,action:"edit",listing}`. Existing D1 adapters recheck ownership, session,
   CSRF, verification, status, expiry, duplicate and active-listing rules inside
   each write. Validation errors return bounded field messages; stale or rejected
   writes return a generic conflict.

The static browser module now activates the production management adapter only
when `location.origin` is exactly `https://postandin.com`; loopback connected mode
and the ordinary static demo remain separate. It reads `#management=` once,
immediately removes the whole fragment with `history.replaceState`, and shows a
scope-neutral confirmation screen. Only after the seller chooses **Continue**
does it explicitly POST the strict 64-character token. Existing cookies recover through
the session route when the seller opens Manage; an ordinary production page load
makes no anonymous session request. The UI supports generic recovery requests, logout, the
transactional management snapshot, listing edits/status changes, seller
delete/recover and the reviewed photo routes. It never stores a CSRF value or
credential persistently; each mutation first recovers the current CSRF value.
New-listing publication is live in production; verified email changes remain
unavailable there instead of falling through to preview simulations. Buyer
contact and reporting are controlled by their production configuration flags.
The hard-coded browse examples remain clearly labelled as sample listings at
every viewport, and their relative ages are suppressed on the production origin.

Expired or replayed recovery tokens, revoked durable credentials, wrong-mailbox
credentials, and malformed credentials fail without issuing access. Raw tokens,
sessions and CSRF values are never stored in D1.

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

The automatic post-verification message uses the shared delivery adapter but a
separate `gear_listing_management_links` table introduced by migration 0020. It
is not a public recovery attempt and does not alter recovery cooldown or delivery
accounting. Redemption rechecks the current seller email and listing state.
The durable bearer has no time-based expiry by design: it remains valid for
available, pending, closed, and expired records so the seller can renew or relist,
and during a valid seller-deletion recovery window. Its permanent invalidation
conditions are listed below.
Active, closed, expired, and seller-recoverable records remain eligible; permanent
deletion cascades the token, verified email transfer deletes it, and an
owner-moderated removal permanently deletes it and revokes any live session for
that listing. Owner restoration does not reissue the link. A rollback past
migration 0020 or an off-provider disaster restore also invalidates saved durable
emails permanently and does not reissue them. Its delivery failure never rolls back the
published listing; the browser tells the seller to check the inbox first, then use
the generic recovery form if needed.

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
