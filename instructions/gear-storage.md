# Gear Exchange local draft storage

Status: local development only. The website preview still uses in-memory sample
records. This increment does not connect the UI, publish to the live site, send mail,
provision D1/R2, or add any deployed Pages API route.

## Files and boundaries

- `migrations/gear/0001_drafts.sql`: additive SQLite/D1 schema for sellers,
  listings and multi-club associations. Foreign keys, price/type checks and
  verification/expiry requirements protect structural integrity.
- `lib/gear-validation.mjs`: allowlisted text/options, adult acknowledgement,
  single email, club/Other rules, integer-cent prices and conditional trade text.
  Client-supplied ownership, verification and status fields are discarded.
- `lib/gear-storage.mjs`: bound SQL writes in a transaction and public-field
  queries. `readLocalDraft` is trusted development tooling, not authorization.
- `scripts/gear/local-db.mjs`: Node SQLite adapter for the D1 methods used here.
  It applies migrations 1–5 once and preserves records on reopening.
- `scripts/gear/local-server.mjs`: loopback-only sample-data API, deliberately
  outside `functions/`. Host, Origin and Sec-Fetch-Site checks reject cross-site browser
  requests and DNS rebinding. It serves no static files and has no CORS allowance.

The storage layer uses D1's documented prepared statements and transactional
batch API: https://developers.cloudflare.com/d1/worker-api/d1-database/
Foreign-key reference: https://developers.cloudflare.com/d1/sql-api/foreign-keys/
Local tests exercise real SQLite, not workerd or a remote D1 instance. D1 runtime
integration remains a separate check before wiring Pages Functions.

## Run locally

Requires Node 24 (tested with 24.16.0), no new npm dependencies. Use fictitious
data only. Choose an absolute database filename outside the website checkout;
the server checks resolved paths to avoid serving stored data as website assets.
For an expendable development database:

```bash
node scripts/gear/local-server.mjs /tmp/postandin-gear-dev.sqlite
```

Listens only on `http://127.0.0.1:8772`. It accepts:

- `POST /drafts`, `Content-Type: application/json`: creates an unverified draft.
- `GET /drafts/{id}`: trusted local inspection, including private sample email.
- `GET /listings`: public projection; empty until a draft is explicitly verified locally.

Example JSON request body:

```json
{
  "title": "Junior club bag",
  "description": "Used bag with a repaired seam and worn zipper.",
  "city": "Seattle",
  "fit": "Junior bag",
  "sellerName": "Sample",
  "email": "sample@example.test",
  "adult": true,
  "category": "Bags & accessories",
  "size": "One size",
  "condition": "Used — good",
  "type": "sale",
  "priceCents": 4050,
  "clubs": ["Kent Valley", "Other"],
  "otherClub": "Example Club"
}
```

All responses, including successful writes, use `no-store`. Requests are capped at 32 KiB.
Unknown routes/records return 404. Bad input returns field errors; database
failures are logged locally and return a generic response. Draft inspection is
not safe to expose remotely, even when a listing ID is random.

## Visibility and state

All drafts start unverified; local token confirmation can publish one draft. Email matching
reuses a seller record but grants no ownership and never verifies that seller.
Local verification and publication endpoints now exist as documented below.
Local authenticated management and relisting are now described in
[gear-management.md](gear-management.md); seller deletion remains pending.

Public queries require available/pending status, verified listing and seller,
and expiry strictly after the read time. Closed, expired, removed and unverified
records are excluded. Queries select explicit public fields and never email,
seller IDs or verification data. The first page is bounded at 100 records;
pagination/search integration comes with the real browse API.

Next: separately verified email changes and bounded draft abuse controls, then
D1/HTTPS validation and UI integration. Per-listing verification, publication
quota, and authenticated management exist locally. Before any remote API exists,
validate deployed authorization and add request abuse limits and retention cleanup.
This local server is not a production security boundary or deployable API.

## Migration and rollback

No root Wrangler file, cloud binding or deployment configuration changed. Local
migration bookkeeping is independent of future D1 migration bookkeeping.
Apply the additive migration to a dedicated test D1 instance before new server
code uses it; production migration remains separately authorized. Roll back
application code without dropping tables or real records. A backup/restore
procedure is not implemented or claimed by this step.

## Verification

```bash
node --test tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs
```

Tests cover reopen persistence, rollback, invalid content, untrusted status
fields, bound-parameter lookup with a SQL-like input, private/public separation, expiry/status checks,
local HTTP boundaries, body size, missing records and generic failure responses.

## Review hardening and next-step invariants

Each listing must be verified by its own token tied to that submission. Reusing
an email/seller record is bookkeeping, never authorization. Verifying a seller
must not publish or verify other drafts. Unverified drafts must not appear in
seller management lists or count toward active-listing quotas; separate abuse
limits for draft submission remain required before a remote API is added.

Sale prices use shared bounds of $1–$5,000 (100–500000 cents), enforced by the
form, validator and database. All timestamps are Unix epoch milliseconds.
Public club names are sorted deterministically. Emails are lowercased before
storage and the schema rejects non-lowercase ASCII email values.

The local path check compares directory filesystem identity, so symlinks and
case aliases cannot place a database inside the checkout. Existing nonempty
files without the Gear migration marker are inspected read-only and refused.
SQLite files and journals are also ignored by Git. Use only sample data;
this is still a single-user local tool, not authenticated remote storage.

The initial migration is still unreleased. If an expendable local database was
created before these review fixes, use a new filename to exercise the updated
constraints; the local runner does not reapply migration 1 to existing Gear
files. No user database is deleted or rebuilt automatically.

Future dedicated D1 configuration must explicitly select `migrations/gear`
as its migration directory; do not assume default root migration discovery.
Verify the chosen configuration with the installed Wrangler schema and runtime
before applying it. No Wrangler configuration or remote migration was added here.

Final review notes: database filenames that are symbolic links (including
dangling links) or existing files with multiple hard links are rejected.
Oversized requests are rejected with 413 and connection close; a client that
continues streaming a very large body may instead observe a connection reset.
This is an accepted local-tool transport limitation: no draft is written and
request buffering stays bounded. Clients should stop sending on rejection.

UI-to-storage integration must map the preview's offer labels to lowercase
types, seller to sellerName, and include the explicit adult acknowledgement.
The preview is not currently connected to these endpoints.

## Local verification and duplicates (current increment)

`lib/gear-verification.mjs` issues a 256-bit random bearer token with a 30-minute
TTL. Only its SHA-256 hash is persisted. Reissue replaces the prior hash for that
submission; consumption is single-use. Tokens snapshot the email and cannot
verify a listing if that email changes. A seller row alone does not authorize
publication of another listing. No management session is granted.

Local-only endpoints (same Host/Origin/body-size restrictions as draft creation):

- `POST /drafts/{id}/verification`, body `{}`: returns a **local mail-sink receipt**
  containing recipient, raw token and expiry. This is trusted test tooling and
  MUST NOT become a public route. A real sender must deliver only to the recorded
  recipient, never return a bearer token to a public caller. Nothing is emailed
  or logged by this simulated delivery. Request JSON and responses use no-store.
- `GET /verification`: returns confirmation instructions; no token consumption,
  publication, expiry update or other mutation, even if query parameters exist.
- `POST /verification/confirm`, body `{"token":"<local receipt token>","confirm":true}`:
  explicitly confirms that token. Invalid, expired, replayed, quota-blocked and
  wrong-state attempts get one generic failure. GET never confirms.

Migration 2 adds tokens and SQL triggers. A conditional token UPDATE plus those
triggers atomically consume the token, verify the seller and publish exactly one
unverified listing, expiring 30 days later. Pending counts toward the active
limit; expired-by-time rows do not. A quota-blocked token remains unused and can
be retried before token expiry once a slot is available. Trigger failure rolls
back all three changes. The trigger repeats ten/30-day rules as SQL literals;
regression tests tie them to shared limits. Replays cannot renew a listing.

Migration 3 adds duplicate keys; migration 4 upgrades earlier local previews
so the unique index covers only available/pending listings. Duplicate prevention
is enforced at publication, never draft creation. Every valid draft gets the
same creation behavior regardless of matches, avoiding an email-ownership
oracle. A raw token is still returned only by trusted local mail-sink tooling.

Matching uses normalized title, category, size, fit, city and club branding,
including Other name. Case, Unicode compatibility, whitespace and club order are
normalized. Price, offer type, description and condition are excluded. Different
sellers are separate. Punctuation, invisible characters or different fit text
can change a key: this is an honest-seller duplicate check, not a spam control.

Multiple unverified drafts are allowed, so an abandoned draft cannot reserve an
item forever. On confirmation, a matching available/pending listing blocks
publication with the same generic failure as other verification failures. The
token remains unused. Time-expired matches are marked expired inside the atomic
publication trigger before inserting the new visible listing. Closed, expired
and removed records do not block publication. Failed publication rolls back all
changes, including token consumption. Draft retention and abuse limits remain
mandatory before remote exposure; real public draft submission must not disclose
whether the supplied email matches existing listings.

After applying migrations, the local runner repairs NULL duplicate keys on every
open (including rows created by older code after a rollback). The repair first
marks time-expired available/pending rows expired and then backfills keys in one
transaction. Active duplicate conflicts roll back that repair and produce an
actionable error; no records are deleted or silently merged. Completed schema
migrations remain recorded. Resolve sample conflicts deliberately or use a new
sample database. Normalization changes require a versioned re-key migration.
Applying SQL alone on D1 does not backfill keys: a tested equivalent repair must
run before enabling writes. D1 triggers/RETURNING/batch and multi-connection
contention remain untested. Sources checked:
https://developers.cloudflare.com/d1/sql-api/sql-statements/
https://developers.cloudflare.com/d1/worker-api/prepared-statements/

Real token landing pages must use no-store, no-referrer and no third-party assets
(or carry the token in a URL fragment and POST it explicitly). Rate-limit token
reissue per listing and recipient before enabling real delivery. No actual email
landing page or remote token service is implemented here.

The pre-management verification increment covered 30 focused cases, including
same-email isolation, replay, exact token expiry, reissue, removed records,
rollback, competing final-slot confirmations, publication duplicates and scanner-safe
GET. Concurrency tests use one local SQLite connection; multi-connection/D1
contention is a separate integration check. Real delivery, browser cookie/CSRF
integration, rate limits and draft cleanup remain unimplemented. Local management
cookies and CSRF checks are covered by the current management tests.

September 26 review follow-up: upgrade tests now cover the original version-1
database and an existing version-3 database with the old unverified-draft index
and publication trigger. Failed-repair tests reopen read-only and compare full
listing rows to prove rollback; publication is also tested at exact expiry.
Those 30 tests passed before the verification increment was committed as
`c2acb18`. This paragraph records that historical verification step; current
management work is described below.

Current continuation: verification is committed as c2acb18. Local management
work and its limits are documented in [gear-management.md](gear-management.md).
The combined suite now has 41 passing tests, including authenticated writes,
recovery/revocation and transactional stale-duplicate cleanup. No production services have been configured.
