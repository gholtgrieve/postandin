# Gear Exchange local owner moderation

Uncommitted local-only package, baseline `b2deab4`, on
`codex/gear-exchange-foundation`. No push, deployment, real mail, production
identity service or remote storage. The owner requires the project to be fully
complete before separately authorizing any deployment.

## Start with sample data

From the canonical checkout, using Node 24 and OpenSSL:

```bash
node scripts/gear/local-owner-key.mjs /tmp/postandin-owner.key
GEAR_OWNER_KEY_FILE=/tmp/postandin-owner.key node scripts/gear/local-preview.mjs /tmp/postandin-gear-owner.sqlite
```

The key generator creates a new random 256-bit local key with mode 0600 and
exclusive creation; it refuses to overwrite an existing file. Both key and sample
database must be outside the checkout; symlink/hard-link and path checks reuse
the existing local path guard. The launcher requires a key file owned by the
current OS user with mode 0600. Do not paste keys into chat, source files, URLs,
logs or review reports. Open the key file locally to copy its contents into the
password field at `https://127.0.0.1:8773/owner/`.

Use `https://127.0.0.1:8773/gear/` to publish sample listings and submit reports.
The existing temporary self-signed certificate flow applies; no OS trust change.
The owner page is deliberately unlinked from the public site and has noindex
metadata. Unknown routes still 404. No key or personal data is embedded in assets.

Keep the same key file to sign in after a restart. To rotate it, stop the server,
create a new key file at a different path, and restart with that path. Restart
revokes all owner sessions. Without GEAR_OWNER_KEY_FILE, the existing local
preview remains available, owner endpoints/assets return 404 on that local server, and report handling
uses its original memory-only mode. Existing persistent moderation data is not
exposed through that mode's `/local/reports` inspection route. On a future Pages
deployment, tracked `/gear/owner.*` assets would be served as inert static files:
they contain no credentials, are unlinked/noindex, and the script refuses API
requests on non-loopback hosts. Committing alone does not deploy them.

## Access boundary

- Owner mode requires HTTPS. `POST /owner/login` accepts `{key}` and sets a
  separate Secure/HttpOnly/SameSite=Strict cookie scoped to `/owner`. It returns
  only CSRF and expiry, not a session token or key. Seller credentials never grant
  owner access and owner credentials do not grant seller sessions.
- One owner session is active per server. Successful login replaces the prior
  session. Session lifetime is one hour, with no sliding renewal. Logout/restart
  revoke it. Session and configured key are represented by hashes in auth state;
  the key is never returned by a read endpoint or logged. The UI clears its password
  field immediately on submission and uses no localStorage.
- Login attempts, including successful ones, are bounded to ten per rolling ten
  minutes per local server. Those counters reset on restart. This is local
  protection, not a production identity or multi-user role system.
- `POST /owner/session` recovers CSRF/expiry only for an existing owner session.
  `POST /owner/action` and `/owner/logout` require owner session, exact Origin and
  CSRF. All owner POSTs require exact Origin and existing host/cross-site/JSON/body
  guards. Duplicate owner cookies are rejected.
- `GET /owner/data` requires owner access. It returns the report queue with current
  listing details, current removals, and the latest 100 history entries. It omits
  seller emails/IDs. `GET /owner/photos/:id` also requires owner access, allowing
  review of photos after removal. Data/photos use no-store.
- In owner mode `/local/reports` returns 404, even when authenticated; the owner
  data endpoint is the only HTTP report inspection path. Other pre-existing local
  sample inbox/draft inspection routes remain trusted local tooling. This server
  must never be publicly exposed or used with real personal data.

## Actions and consistency

Every action requires a reason of 1–500 characters and current owner authorization.
No automatic action occurs when someone submits a report.

- **Dismiss report:** accepts an open report ID, records the decision and marks it
  dismissed, without changing the listing. The reason and original report reason
  are preserved in history.
- **Remove listing:** accepts an open report ID. The current listing must be
  verified, have a verified seller, and be available or pending. Removal records
  its prior status and sets it to removed without changing expiry/content/photos.
  Read-time expiry may already have elapsed; removing such a listing still does
  not renew it. Public browse, buyer contact, reports and public photos stop
  accepting/exposing it through their existing guards. Seller edits, renewal and
  photo changes cannot undo the removal. Existing seller-private read access stays
  intact; removal is not deletion.
- **Restore listing:** accepts a listing ID with a recorded local removal. It must
  still be removed, both verification flags must remain present, expiry must be
  strictly in the future, and the current seller must have room below the active
  listing limit and no live duplicate. Restore returns the saved available/pending
  status, never extends expiry and never resurrects an expired item. It follows
  current ownership after an email transfer. Only stale duplicate rows needed by
  the existing unique index are expired, in the same transaction.
- All listing/removal/report-resolution changes and the history insert occur in a
  single SQLite transaction. If history insertion or another write fails, every
  change rolls back, including stale-duplicate cleanup. Replayed or stale actions
  return a conflict rather than silently changing state or duplicating history.
- History stores actor `local-owner`, action, listing ID, optional report ID and
  original report reason, decision reason, before/after status and time in ms.
  The actor denotes possession of the shared local key, not a verified individual.
  The local database operator can alter SQLite directly; this is not a tamper-proof
  audit service. The UI shows the latest 100 entries; stored history is not pruned.

## Storage and UI

Owner mode additively creates `gear_local_reports`, `gear_local_removals` and
`gear_local_moderation_history` in the sample SQLite database, like the existing
local-only photo table. No D1 migration/version or remote schema was added.
Reports, resolutions, active removals and history survive server/database reopen.
The queue still retains only the latest 20 reports, including resolved entries;
older unresolved reports can be evicted. History retains action context even if a
report is evicted. Retention/cleanup and record/photo restore remain the next
separate package; persistence alone is not a backup or restore guarantee.

Persistent report insert and eviction are transactional. Report validation and
three-per-listing/twenty-per-server limits remain unchanged; counters are in memory
and reset on restart. Owner-disabled mode keeps its memory-only report queue.
Memory-only reports from an earlier run are not imported when owner mode starts.

The dashboard shows current listing details/photos with reports, removal reason
and restore controls, and action history. It uses text nodes for all user text.
Actions freeze controls and preserve the reason on failure. A lost response warns
to refresh before retrying; refresh reveals the committed state. A confirmed write
followed by refresh failure is identified as saved, clears the stale private view
and asks for sign-in to refresh. There is no automatic mutation retry. Session
loss and sign-out clear private dashboard contents. Cancel/undo notifications,
seller email notices and account-wide bans are not included.

## Verification and review

```bash
node --test tests/gearModeration.test.mjs tests/gearReports.test.mjs tests/gearContact.test.mjs tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearExchange.test.mjs tests/gearStorage.test.mjs tests/gearVerification.test.mjs tests/gearManagement.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-owner-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
git diff --check
```

Observed: 80 Node tests pass, including eight owner tests for session boundaries,
revocation/rate limits, seller separation, key-file protections, HTTPS guards,
safe failures, dismiss/remove/restore, public photo/contact removal, seller write
rejection, exact expiry, quota/duplicates, transferred ownership, rollback and
persistence/eviction. The focused eight tests also pass after final rollback and
visibility assertions. Changed JavaScript syntax and diff checks pass.
Both Chrome harnesses pass, with no unexpected console errors/page exceptions.
Owner checks include login/reload/dismiss/remove/restore/history/logout, required
reason, failed-write preservation, lost-response recovery and unauthorized photos.
Layouts pass at 1040/390/320 pixels; desktop/mobile screenshots were inspected.
Owner metadata, sitemap/homepage exclusion, robots policy and unknown-path/404
behavior were checked. D1/workerd and production identity/storage remain untested.

Owner-mediated Claude review approved the local-only package with no
blocker/high/medium findings and one low-priority UI finding. History now displays
the stored original report reason, with a browser regression assertion. The local
404 versus future inert static-asset distinction is clarified above. Claude
independently passed all 80 tests and both browser harnesses. The focused owner
browser harness, syntax and diff checks pass after these follow-ups; no second
Claude review. Baseline: `b2deab4`; included in the local commit titled
`Add local owner moderation and reversible Gear removal` (see Git for hash).
No push or deployment.
