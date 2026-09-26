# Gear Exchange local seller management

Status: local development only, September 26, 2026. No UI wiring, deployed
Pages routes, real mail or cloud resources. Read the Resume here section in
`gear-exchange-plan.md` first. This builds on commit `c2acb18`.

## Access and state contract

- `lib/gear-management.mjs` and migration 5 implement management credentials.
  A verified mailbox can receive a simulated recovery link. Link tokens are
  256 random bits, hash-only in storage, expire after 30 minutes and are single
  use. Reissue invalidates older links without terminating current sessions.
- Explicit confirmation redeems the link, creates a fresh 24-hour session and
  revokes all previous sessions for that seller in one SQL statement/trigger.
  A failed session insert rolls back both revocation and token consumption.
- Session and CSRF credentials are random, hash-only and separate from listing
  verification tokens. A verification token cannot establish a session.
- Management lists only individually verified records of that seller. Matching
  an unverified draft's email never makes that draft visible or editable.
  Removed records can be seen by their owner but cannot be edited or relisted.
- Content edits preserve owner, status and expiry. Server validation and duplicate
  keys are recomputed; club replacement is atomic via a trigger. `management_clubs`
  is an internal JSON write payload, not a public response field.
- Mark pending/available requires a currently active, unexpired listing. Closing
  accepts active/pending/expired listings. Relisting accepts closed/expired or
  expired-by-time listings, renews 30 days, and enforces the active limit including
  pending. Relist directly on an active listing is rejected. Closing then relisting
  intentionally starts a fresh 30 days, subject to quota and duplicate checks.
- Ownership, session expiry/revocation and CSRF are rechecked inside each write.
  Unique constraints prevent edits/relisting from creating active duplicates.
  Before an edit or relist, the same transaction expires matching stale records
  belonging to the authenticated owner, excluding the target. This works during
  a long-running server session; an error rolls back cleanup and the write.
  Cleanup may commit when the target write is a no-op; those matches were already
  expired by time and excluded from public reads.
- Email changes are explicitly rejected; equivalent capitalization or surrounding
  whitespace is normalized before comparing the existing address. A separately verified ownership-transfer
  design is still needed; do not silently change the email on the seller row.
  Adult confirmation is not re-collected for edits to previously verified records.

## Local API

Start the server using `gear-storage.md`. The browser design preview remains
separate. All responses are no-store and no-referrer. Host/Origin/Fetch-Site checks
remain enabled. Every management POST additionally requires an exact same-origin
Origin header (`http://127.0.0.1:8772` for the default server).

| Method and path | Input / behavior |
|---|---|
| POST `/management/recovery` | `{ "email": "sample@example.test" }`; same response for known/unknown email |
| GET `/local/management-mail` | Trusted local-only simulated mailbox, at most 20 receipts; never deploy this route |
| GET `/management/confirm` | Instructions only; no state changes |
| POST `/management/confirm` | `{ "token": "<local receipt>", "confirm": true }`; sets session cookie and returns CSRF token/expiry |
| GET `/management/listings` | Requires cookie; returns up to 100 owner records, excludes unverified drafts and private credentials |
| POST `/management/listing` | `{ "id": "...", "action": "pending|available|close|relist" }`, or action `edit` plus full `listing` content |
| POST `/management/logout` | Revokes current session and clears cookie |

Listing writes/logout require the `X-Gear-CSRF` header returned on confirmation.
Cookies use `Path=/management; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.
The JSON response never returns the raw session cookie value. Core functions
return credentials to the HTTP adapter only. Local tests explicitly transport
cookies; browser Secure-cookie behavior over loopback HTTP has not been tested.
Use HTTPS for browser integration; do not remove Secure for deployment.

`/local/management-mail` exposes raw simulated delivery credentials deliberately
for trusted local testing. It is not an authenticated inbox or a production
recovery interface. Receipts are in memory, never logged, and reset on restart.
Real delivery must send only to the recorded recipient, and public responses
must stay generic. Rate limits, bounce handling and delivery retries are pending.

## Validation and remaining work

Run:

```bash
node --test tests/gearManagement.test.mjs tests/gearVerification.test.mjs tests/gearStorage.test.mjs tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs
```

41 tests pass locally, including recovery replay/expiry/reissue, session
revocation, cross-owner access, unverified isolation, CSRF/Origin enforcement,
edit/cleanup rollback, quota, active duplicate rejection, time-expired relisting,
email normalization and changed-mailbox link rejection. Writes after expiry or
revocation, missing CSRF, foreign/unverified edits, duplicate cookies, missing
Origin, HTTP edit validation, and the stored session duration are also covered. No D1/workerd or
multi-connection contention tests have run. Trigger/API behavior must be tested
there before remote integration. Migration 5 is additive; local runner applies
it once after migrations 1–4. No automatic data deletion occurs on rollback.

Still needed: separately verified email change, seller deletion/retention,
management pagination, real HTTPS browser flow, abuse limits, UI integration,
and D1 validation. Before UI integration, design CSRF recovery after reload:
currently CSRF is returned only at confirmation, so a client that loses that
value must redeem another link. Do not claim a persistent browser management
flow exists yet. Before real mail, throttle recovery per recipient to prevent
repeated requests from invalidating legitimate outstanding links.

## September 26 review follow-up

Claude's first source-only review found no blocker/high issue. The requested
write-path and HTTP tests, stale-duplicate cleanup, normalized email comparison,
and documentation corrections are implemented. Claude re-review concluded
**ready to merge for this local increment**, with no blocker/high/medium findings.
Its minor follow-ups are also fixed: stable handoff anchors, well-formed wrong
CSRF tests, and a cookie lifetime derived from MANAGEMENT_TTL_MS. The 41-test
suite passes after these follow-ups; they were not sent for another review.
The owner authorized committing this local increment. No remote service, real
delivery, push, merge, or deployment is included.
