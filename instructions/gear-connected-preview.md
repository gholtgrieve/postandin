# Gear Exchange connected local preview

September 27, 2026. Development-only browser integration, not a deployed API.
The static `/gear/` design preview remains simulated unless served explicitly by
the local HTTPS launcher below. Existing production homepage links are unchanged.

## Run with sample data

From the canonical repository, with Node 24 and OpenSSL installed:

```bash
node scripts/gear/local-preview.mjs /tmp/postandin-gear-connected.sqlite
```

Open `https://127.0.0.1:8773/gear/`. The certificate is locally generated and
self-signed; the browser will require a local certificate exception. No OS trust
store changes are made. Use sample data only: this server intentionally exposes
trusted local draft inspection and simulated inboxes. The database must be an
absolute path outside the checkout, as enforced by the existing path guard.
Stop with Ctrl-C. Database contents persist; simulated inbox receipts do not.

The local launcher uses an ephemeral certificate, deletes its on-disk key after
loading, and serves the preview and API on the same loopback HTTPS origin.
`localServer(db,{tls,preview:true})` opts in. Preview without TLS is refused.
An exact file allowlist serves only gear HTML/CSS/JS and the shared options module;
there is no general repository file server. Private files and unknown paths 404.
Local HTML receives a `data-local-api` marker, no-store/no-referrer/noindex headers,
and has the external Google Fonts link removed. The static source HTML receives
no marker, so normal static hosting continues to use in-memory examples.

## Working user flow

1. Post gear using the existing form. The client maps offer labels to lowercase,
   seller name to `sellerName`, and carries the adult acknowledgement. Drafts are
   saved unverified and never appear in browse before confirmation.
2. The verification screen shows a simulated local receipt. Explicitly confirming
   publishes the listing in the local database. No email is sent and no management
   session is granted by verification.
3. Request a management link, then explicitly confirm the simulated local inbox
   receipt. The existing Secure/HttpOnly cookie provides session access. The
   request response stays generic; the separate local inbox is trusted tooling.
4. Managed listings reload through the API. CSRF is recovered on each write and
   after reload, using the existing same-origin session endpoint. Tokens are not
   put in localStorage or URLs. Edit preserves owner/status/expiry; ordinary edit
   hides the email field. Pending, available, close and relist use guarded writes.
5. Browse/detail use public records and city/gear/club/type filters. Sorting now
   uses cents consistently. Sign-out revokes access and clears managed records.

Each mutation is guarded against repeated button clicks while pending. Failed
writes display an error and preserve form fields. Backend authorization, quota,
duplicate checks and validation remain authoritative; the client never optimistically
claims publication. A request that created a draft but lost its response can leave
an abandoned draft; retry may create another draft, but duplicate publication is
still rejected. No draft idempotency or abandoned-draft cleanup is claimed.

## Deliberate boundaries

- Photos are disabled in connected mode until persistent image storage exists;
  demo-fill does not attach fake stored photos. Static demo photos remain simulated.
- Buyer contact and reports retain their explicit preview-only messaging.
- Delete is omitted from connected management because deletion/retention is not
  implemented. Removed records are read-only.
- Email transfer exists in the local backend but does not yet have a connected UI.
- No pagination beyond the backend's current 100-record read limit, real email,
  cloud media storage, remote bindings, Pages handlers or deployment was added.
- No third-party asset is required by connected mode. Other site navigation routes
  are outside this narrow local server and may return 404.

## Verification and review handoff

```bash
node --test tests/gearConnectedPreview.test.mjs tests/gearManagement.test.mjs tests/gearEmailChange.test.mjs tests/gearVerification.test.mjs tests/gearStorage.test.mjs tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
```

Observed: all 56 Node tests pass; all eight D1 groups pass with Claude's optional
follow-ups; connected HTTPS Chrome check passes posting, explicit verification,
login/reload, edit, pending/close/relist, browse/detail, logout, duplicate rejection,
interrupted-save retry, server restart persistence, file allowlist, zero API calls
in unmarked static demo, and no page exceptions. Desktop 1040px and mobile
390/320px were checked, with no horizontal overflow in browse/detail/post/manage.
Desktop detail and mobile management screenshots were visually inspected.

The browser harness uses existing externally installed Playwright/Chrome and
ignores its temporary self-signed certificate only in isolated test contexts.
No package/build dependency was added. Set GEAR_PREVIEW_SCREENSHOT to an absolute
prefix outside the repo to optionally capture desktop/mobile PNGs.

Review baseline: `2d33253`; compare it with the connected-preview commit, including
`gear/local-api.mjs`, `scripts/gear/local-preview.mjs`,
`scripts/gear/browser-preview-check.mjs` and this document. Commit title:
`Connect Gear Exchange preview to the local HTTPS API`.
Claude’s initial detailed review found no high-severity issues. Confirmed findings
have been fixed. Claude re-review approved this local-only increment with no
blocker/high/medium findings. Three low follow-ups were fixed and retested after
that review: shared city normalization, safe unexpected errors and hiding unused
contact help/age controls while editing. These final small edits have not had a
third Claude pass. This increment is included in that local commit; no push, merge or deployment.

## Review fixes and regression coverage

Errors are focused and scrolled into view; server field validation returns the
form to the relevant step. Unreadable and interrupted responses use generic
messages. Successful writes are reported separately from subsequent refresh
failures, with a Refresh listings control. Logout clears private listing UI
immediately; expired sessions reveal the recovery form. Changing the recovery
email invalidates the displayed receipt. Ordinary edits hide the email field.
The local simulated inbox does not prove ownership of an email address.

A known draft ID is reused when reissuing an expired verification link. If a
confirmation response is lost, the client checks whether that ID is visible in
the public read before reporting failure. This recovery is limited by the public
read's 100-record limit and connectivity; it is not general write idempotency.

Additional browser cases cover Free and Trade offers, Other club text, escaped
listing text, invalid email field feedback, expired/reissued verification links,
lost confirmation responses, refresh failure after publication and logout,
changed recovery recipients, malformed API responses, and session expiry during
an edit. Both connected and static modes are monitored for page exceptions and
unexpected console errors. Unit/integration tests cover adapter contracts,
TLS-only preview opt-in and the exact static-file allowlist. D1 coverage asserts
the email-transfer quota trigger's specific failure and transaction rollback.
