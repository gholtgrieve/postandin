# Gear Exchange local verified email change

September 26, 2026. Local sample-data development only. Built after management
commit `06be078`. No real mail, Pages routes, UI wiring or deployment.

## Contract

- POST a new mailbox using a live management session and its CSRF token.
  Shared `normalizeEmail` validates a single address and normalizes case/space.
  The new address must differ from the source; requesting never changes ownership.
- A 256-bit random confirmation token is delivered only to the new address in a
  trusted local simulated inbox. Storage keeps its SHA-256 hash. It expires in
  30 minutes, is single use, and reissue replaces the previous request.
- Confirmation requires an explicit POST, exact same Origin and the token. It
  does not require a recipient session, allowing confirmation on another device.
  GET does nothing. It creates no management session and returns no credentials.
- The originating session must still be valid at confirmation. Logout, session
  expiry or replacement by a new management login cancels its transfer authority.
  Requesting a recovery link alone does not revoke a session. A session may
  request only its own seller's transfer; there is no client-supplied seller ID.
- Transfer moves all individually verified source listings at confirmation time,
  including pending, closed, expired and removed records. Listing IDs, content,
  photos/club associations, verification dates and expiry stay unchanged, except
  stale available/pending records become expired. Removed listings stay removed.
  A listing published between request and confirmation is included.
- Unverified drafts stay with their original mailbox. Verifying the destination
  seller does not publish or grant management access to its unverified drafts.
  Seller email rows are never renamed. The old mailbox can recover a fresh empty
  session or later publish its own drafts; it cannot access transferred records.
- An existing destination is merged only after token confirmation. Combined live
  available/pending listings must total at most ten, and live duplicate gear is
  rejected by the unique index. Stale records on both sides are expired inside
  the same transaction before the move. Failures return a generic result and
  leave ownership, sessions, links and token consumption unchanged; a conflict
  can be resolved and the same unexpired token retried.
- Success revokes every existing session and recovery link for both source and
  destination. Their other outgoing transfer requests also become unusable
  because they reference revoked sessions. The new address must request a fresh
  management link. Previously issued verification tokens for unverified drafts
  remain bound to those unmoved drafts and original addresses.

## Files and routes

`lib/gear-email-change.mjs` issues/consumes requests. Migration
`0006_email_change.sql` adds request storage and guard/apply triggers. A single
conditional token UPDATE runs the quota check, transfer, revocation and link
invalidation atomically. Migration 6 is additive and local runner applies it once.
Unexpected database errors propagate to the HTTP adapter for generic 500 output;
expected expired/revoked/quota/duplicate failures expose no destination inventory.

| Method/path | Behavior |
|---|---|
| POST `/management/email-change` | JSON `{email}`; requires session cookie, X-Gear-CSRF and exact Origin; no token returned |
| GET `/local/email-change-mail` | Trusted loopback sample inbox, max 20 receipts, in memory; never deploy |
| GET `/management/email-change/confirm` | Confirmation instructions only, no mutation |
| POST `/management/email-change/confirm` | JSON `{token, confirm:true}`; exact Origin; success or generic failure |

All normal local-server host, fetch-site, JSON/body-size, no-store and no-referrer
rules apply. No raw tokens are logged or saved in repo files. Token landing UI is
not implemented; future UI should avoid leaking tokens via URLs/third-party assets.

## Verification and next steps

```bash
node --test tests/gearEmailChange.test.mjs tests/gearManagement.test.mjs tests/gearVerification.test.mjs tests/gearStorage.test.mjs tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs
```

49 focused tests pass locally. The eight email-change cases cover transfer and
unchanged fields, draft isolation, both-side revocation, single-use/reissue,
wrong CSRF, validation, exact expiry, existing/unverified destinations, inactive
states, quota and duplicates, stale cleanup, full rollback, competing transfers,
scanner GET, Origin, explicit confirmation and generic HTTP failure responses.
Competition uses one SQLite connection; this is not multi-connection testing.

Claude source review concluded **ready to merge for this local-only increment**,
with no blocker/high/medium defects. Minor follow-ups added replacement-login
cancellation, post-request publication, mismatched-session CSRF, missing Origin
and no-cookie-grant assertions; all 49 tests pass afterward. These additions were
not separately re-reviewed. Validation may return 400 before authentication for
a malformed email paired with well-formed invalid credentials; this reveals only
input validation and is accepted for the local API. D1/workerd trigger/batch behavior and actual
deployed browser behavior remain untested. Local session recovery and an HTTPS
Chrome API lifecycle check are now implemented; see `gear-management.md`. Before real delivery add abuse throttling, old/new
address notifications and delivery handling. Seller deletion, retention and
restore are separate unfinished work. No real email provider was configured.

Subsequent validation: email-transfer triggers, rollback, conflicts and revocation
now pass against local D1/workerd; see `gear-d1-validation.md`. Remote D1 and full
Worker request handlers remain untested.
