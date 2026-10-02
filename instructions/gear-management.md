# Gear Exchange local seller management

Status: local development only, September 26, 2026. No UI wiring, deployed
Pages routes, real mail or cloud resources. Read the Resume here section in
`gear-exchange-plan.md` first. This builds on commit `c2acb18`.

## Access and state contract

- `lib/gear-management.mjs` and migration 5 implement management credentials.
  A verified mailbox can receive a simulated recovery link. Link tokens are
  256 random bits, hash-only in storage, expire after 30 minutes and are single
  use. Reissue invalidates older links without terminating current sessions.
- Explicit confirmation redeems the link, creates a fresh 30-day session and
  revokes all previous sessions for that seller in one SQL statement/trigger.
  A failed session insert rolls back both revocation and token consumption.
- Sessions use 256 random bits. CSRF is a SHA-256 derivation of a domain label
  plus the raw session secret. Both credentials are stored only as hashes and
  remain separate from listing verification tokens. A verification token cannot establish a session.
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
  whitespace is normalized before comparing the existing address. Use the separate verified transfer flow in
  [gear-email-change.md](gear-email-change.md); never rename the seller row.
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
| POST `/management/listing` | `{ "id": "...", "action": "pending|available|relist" }`, or action `edit` plus full `listing` content. Seller removal uses the deletion route so its 30-day clock is always recorded. |
| POST `/management/logout` | Revokes current session and clears cookie |
| POST `/management/session` | JSON `{}` with Content-Type application/json, cookie plus exact Origin; returns CSRF/expiry after reload; never creates or renews a session |

Listing writes/logout require the `X-Gear-CSRF` header returned on confirmation
or session recovery. Recovery is an exact-Origin POST, not a GET, and requires
the existing HttpOnly cookie but no prior CSRF value. It returns only CSRF and
original expiry, with no-store/no-referrer and no Set-Cookie. Missing, revoked or
expired sessions return 401; invalid Origin returns 403.
Cookies use `Path=/management; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`.
The JSON response never returns the raw session cookie value. Core functions
return credentials to the HTTP adapter only. Unit HTTP tests explicitly transport cookies. The separate HTTPS Chrome check
uses actual browser-managed cookies; see the browser command below. Secure-cookie
behavior over plain loopback HTTP is not claimed. Do not remove Secure.

`/local/management-mail` exposes raw simulated delivery credentials deliberately
for trusted local testing. It is not an authenticated inbox or a production
recovery interface. Receipts are in memory, never logged, and reset on restart.
Real delivery must send only to the recorded recipient, and public responses
must stay generic. Rate limits, bounce handling and delivery retries are pending.

## Validation and remaining work

Run:

```bash
node --test tests/gearEmailChange.test.mjs tests/gearManagement.test.mjs tests/gearVerification.test.mjs tests/gearStorage.test.mjs tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs
```

51 tests pass locally, including recovery replay/expiry/reissue, session
revocation, cross-owner access, unverified isolation, CSRF/Origin enforcement,
edit/cleanup rollback, quota, active duplicate rejection, time-expired relisting,
email normalization and changed-mailbox link rejection. Writes after expiry or
revocation, missing CSRF, foreign/unverified edits, duplicate cookies, missing
Origin, HTTP edit validation, and the stored session duration are also covered. No D1/workerd or
multi-connection contention tests have run. Trigger/API behavior must be tested
there before remote integration. Migration 5 is additive; local runner applies
it once after migrations 1–4. No automatic data deletion occurs on rollback.

Verified email transfer is now implemented locally; see `gear-email-change.md`.
Still needed: seller deletion/retention,
management pagination, abuse limits, UI integration and D1 validation. The local
HTTPS API session lifecycle and recovery after reload are tested. The product
preview remains simulated; no management UI wiring or deployed flow is claimed. Before real mail, throttle recovery per recipient to prevent
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


## Session recovery and real-browser check — September 26

CSRF is derived using SHA-256 of `gear-management-csrf-v1:` plus the raw session
secret. Knowing the CSRF token does not reveal the cookie. Recovery recomputes
it server-side and writes only its hash after rechecking session lifetime and
revocation. New sessions already use this value, so reloads and multiple tabs
share it without invalidating each other or extending expiry. Pre-increment
sessions with random CSRF migrate on their first recovery; an older tab holding
the former value must recover once too. No schema migration is needed.

`localServer(db, {tls: {key, cert}})` supports HTTPS test servers; the ordinary
CLI still serves HTTP at 127.0.0.1:8772. Origin is derived from the actual socket,
not forwarded headers, and must match protocol, host and port exactly.

Run the optional checked-in browser harness with an already installed Playwright
module (no new package dependency):

```bash
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-session-check.mjs
```

Requires Node 24, OpenSSL, Chrome and that external Playwright installation.
The harness creates a temporary certificate/private key outside the repo,
starts two loopback HTTPS origins and uses an in-memory sample database. It
ignores only self-signed certificate validation in its isolated browser contexts;
normal cookie and cross-origin policies remain enabled. Temporary files, browsers
and listeners are cleaned up on completion. No OS trust store changes occur.

Observed PASS in Chrome: Secure/HttpOnly/SameSite/Path/lifetime, hidden cookie in
page JavaScript, reload and two-tab CSRF recovery, writes from either tab,
anonymous isolation, a same-site different-origin bootstrap rejected with 403,
logout cookie clearing, replacement-login revocation and exact server expiry.
51 Node tests also pass, including stable/legacy recovery, no expiry renewal,
wrong/duplicate cookies, invalid Origin and GET non-mutation. Claude source review found no security/correctness defects and requested stronger
legacy-upgrade testing. That assertion, documented command/body details, and
harness cleanup for failures/SIGINT/SIGTERM are fixed. All 51 tests and the
HTTPS Chrome harness pass afterward; the follow-ups were not re-reviewed. Actual D1, deployed origin/proxy behavior, other
browsers, and product UI remain untested.

Subsequent validation: local D1/workerd storage checks now pass. See
`gear-d1-validation.md`; earlier D1-untested notes above record the management
review stage. Remote deployment and full Worker request handlers remain untested.
