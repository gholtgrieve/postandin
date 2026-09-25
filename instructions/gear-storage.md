# Gear Exchange local draft storage

Status: local development only. The website preview still uses in-memory sample
records. This increment does not connect the UI, publish listings, send mail,
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
  It applies the first migration once and preserves records on reopening.
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
- `GET /listings`: public projection; normally empty because no publication
  operation exists in this increment.

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

Only draft creation is implemented: all drafts start unverified. Email matching
reuses a seller record but grants no ownership and never verifies that seller.
There is no update, deletion, publication, renewal or verification endpoint.

Public queries require available/pending status, verified listing and seller,
and expiry strictly after the read time. Closed, expired, removed and unverified
records are excluded. Queries select explicit public fields and never email,
seller IDs or verification data. The first page is bounded at 100 records;
pagination/search integration comes with the real browse API.

Next: verified ownership, safe management sessions, token lifecycle and bounded
draft/active-listing quotas, then UI integration. Before any remote API exists,
add authentication/authorization, request abuse limits and retention cleanup.
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
node --test tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearPreviewVisibility.test.mjs
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
