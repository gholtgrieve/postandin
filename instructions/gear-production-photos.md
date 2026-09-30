# Gear Exchange production photo pipeline

Status: source-only foundation and not deployed. D1 quarantine ownership,
authenticated Pages orchestration and atomic attachment exist, but no UI,
service binding, delivery variant, signed-delivery key or production resource
is configured.

## Private quarantine and trusted sanitization

`lib/gear-image-upload.mjs` implements the provider-facing portion of the
owner-approved workflow:

1. The authenticated upload route asks Cloudflare Images for a Direct Creator
   Upload URL that expires after ten minutes. The object is marked only as a
   Gear quarantine object and requires signed delivery.
2. The browser uploads the original directly to that private quarantine. The
   original is temporarily stored by Cloudflare, but is never published or
   attached to a listing.
3. The authenticated finalize route passes the quarantine provider ID to the adapter.
   The adapter downloads the actual bytes, enforces a 5 MiB streaming limit, and
   requires Cloudflare Images to decode an image no larger than 25 million
   pixels or 12,000 pixels on either side.
4. The Images binding scales down to a 1600-pixel box without upscaling and
   requests a still WebP at quality 85. Cloudflare documents that non-JPEG
   transform output discards metadata and applies EXIF orientation. The adapter
   independently verifies exact RIFF/WebP framing, safe feature flags, extended
   image ordering, alpha and pad bytes; rejects metadata, animation and unknown
   chunks; permits exactly one still image; verifies expected scale-down
   dimensions; and streams at most 10,000,000 output bytes into memory.
5. Only the verified bytes are uploaded as a new private hosted image, using a
   fixed filename and fixed non-personal metadata. Its metadata includes the
   quarantine provider ID as a reconciliation key. The quarantine is then
   deleted. A failed delete is returned as a provider ID for durable cleanup.

Malformed provider upload results trigger immediate best-effort deletion of any
bounded provider-returned ID and the quarantine. Any deletion that throws is
returned in `GearImageUploadError.cleanupProviderIds`; it never appears in the
public error message. That array contains only IDs whose deletion was attempted
and threw; an empty array does not say whether a pre-verification ID was a valid
quarantine. The future route must immediately delete or enqueue every returned
ID in `gear_photo_deletions` before responding.

No request/response API can identify an image if the provider stores it and then
throws before returning its ID, or if the Worker stops after upload and before D1
attachment. The sanitized upload's `purpose` and `source` metadata make those
objects discoverable. Scheduled reconciliation now lists both Gear photo purposes
with a 24-hour grace period, validates the private fixed metadata, and atomically
queues only objects with no D1 reference. A retained sanitized conflict row is
cleanup work. A sanitized provider commit that happened before its D1 write has no
D1 reference and is protected only by the 24-hour grace period.

## Durable ownership and attachment state

Migration 11 adds `gear_photo_quarantines`. `lib/gear-photo-quarantine.mjs`
records each Direct Creator Upload provider ID against the authenticated seller
and listing for ten minutes. It stores neither session/CSRF values nor upload
credentials. Finalization takes a five-minute, SHA-256-only claim lease so
concurrent requests cannot both process one quarantine. Record and claim require
a current management session, matching CSRF value, verified listing ownership
and a manageable listing state.

After the asynchronous transform, attachment repeats every authorization and
ownership check inside the D1 batch. The batch records the sanitized provider
ID, inserts it into the lowest free photo slot, stages the original quarantine
ID in `gear_photo_deletions`, and consumes the quarantine as one transaction.
The outbox step is unconditional and idempotent: it safely covers both a failed
original-image deletion and a provider object already gone. Revocation, ownership
transfer, stale claims and wrong claims cannot attach. A replay after a committed
attachment returns a distinct non-compensating `attached` result, so the route
must never compensate a sanitized ID already present in `gear_photos`. If all six slots are
occupied, the quarantine retains the sanitized provider ID as a durable cleanup
reference. That retained row is a cleanup target, not a live image reference;
it can never later attach merely because a slot becomes free. Quarantine rows deliberately
have no seller/listing foreign key: deletion or ownership transfer must not erase
the only remote cleanup reference. A valid in-flight claim may finish after the
upload URL/quarantine issuance deadline, but never after its own five-minute
lease.

`POST /api/gear/management/photos/upload` performs a cheap authenticated capacity
pre-check before creating a billable provider object, then applies the atomic D1
reservation. A raced rejection triggers the Worker's bounded immediate delete;
if that fails, Pages writes the provider ID to `gear_photo_deletions` before
responding. Issuance reserves at most six combined attached photos and live
unsanitized quarantines per listing.

`POST /api/gear/management/photos/finalize` takes a claim lease, distinguishes
retryable pending/unavailable states from terminal rejection, and never returns
the sanitized provider ID. Retryable states release the claim. Terminal states
atomically queue cleanup and consume it. Attachment retries once with the same
claim and sanitized ID after an indeterminate D1 exception, so a committed replay
cannot cause a live image to be deleted. Cleanup references returned by the
service are bounded and validated. Terminal references are durably queued;
after successful attachment the original is staged atomically by the attach
batch, and any additional service references are staged best-effort.

If both attachment attempts throw, Pages makes one conditional outbox insert for
the sanitized ID; the insert is a no-op if either ambiguous attempt actually
committed it to `gear_photos`. If D1 is still unavailable, the route returns a
generic failure and the required provider-metadata reconciliation remains the
only way to find that unreferenced sanitized object. Reconciliation is therefore
a launch prerequisite, not optional cleanup.

Both endpoints require the existing exact-origin management session and CSRF
header and use bounded exact-shape JSON. The browser receives only the temporary
quarantine ID, provider upload URL and reservation deadline. The claim and
sanitized ID stay server-side. Per-seller and per-IP upload rate limiting remains
a launch gate and must be applied before the upload route is exposed. Source also
requires `GEAR_PHOTO_UPLOADS_ENABLED=true`, in addition to both bindings, so merely
adding the service binding cannot accidentally enable uploads.

`POST /api/gear/management/photos/remove` accepts exactly
`{listingId,photoId}`. `POST /api/gear/management/photos/reorder` accepts exactly
`{listingId,photoIds}`, where `photoIds` is the complete ordered set of one to six
current attached photo IDs. Both require the same exact-origin session and CSRF
checks. They return 200 on success, 409 for a stale or rejected mutation, and the
shared 400/401/403/413/415/500/503 management-route errors. They need only
`GEAR_DB`: unlike upload/finalize, they do not create or call a provider object,
so the upload feature flag and Images service binding do not gate them.

## Route behavior and remaining lifecycle requirements

The route slice now:

- requires the existing seller management session and CSRF protection on both
  upload creation and finalization;
- calls the durable record/claim/attach operations at the provider boundaries;
  `pending` means the browser upload has not finished and `unavailable` is
  retryable, so each must release the claim without consuming the quarantine;
- transactionally attaches the sanitized provider ID or immediately deletes/enqueues
  it if D1 attachment fails; on an indeterminate batch exception, first retry
  attachment with the same server-held claim and sanitized ID so `attached` or
  success prevents unsafe compensation and a confirmed conflict can be cleaned;
- deletes or enqueues the original quarantine on every terminal failure;
- removes an attached photo only for the current seller/session/listing, stages its
  provider ID in the durable deletion outbox in the same D1 transaction, and
  compacts the remaining order without exposing a provider ID;
- accepts only a complete, duplicate-free ordering of the listing's current photo
  IDs. Reorder replaces the metadata set atomically after rechecking the exact
  pre-read snapshot, ownership, CSRF, session lifetime and manageable listing
  state. A concurrent upload/removal loses safely instead of resurrecting or
  dropping an object.

The next lifecycle slice must:

- project only short-lived signed URLs for the configured public variant.

Reconciliation treats expired unclaimed rows, expired claim leases and every row
with `sanitized_provider_id IS NOT NULL` as cleanup work. Listing purge does not
cascade these rows. The sweep covers both `purpose:gear-photo-quarantine`
originals and `purpose:gear-photo` sanitized objects. Attached references are
protected, retained conflicts remain cleanup work, and pre-D1 in-flight uploads
rely on the grace period. Each purpose pass scans at most 1,000 returned objects
per attempt and saves its opaque continuation cursor, so a larger inventory
resumes on the next attempt without a false alert.
The provider is asked to filter by purpose, but every returned object is checked
again because the local workerd Images binding currently ignores that option.

No original filename, user-provided metadata, image bytes, upload URL or signed
delivery URL belongs in D1. Provider IDs are cleanup references, not credentials.
The claim and sanitized provider ID remain server-side and are never accepted
from or returned to the browser as authority. The adapter and schema also reject
using the original quarantine ID as the sanitized ID.

`gear-images/src/index.js` now supplies the source-only provider boundary as a
small service-binding-only Worker. Its example config disables public worker and
preview URLs; no route, resource or binding is provisioned. The Pages source
expects a future `GEAR_IMAGES` service binding. The Worker
accepts only bounded internal JSON for create, sanitize and idempotent delete,
and keeps provider errors generic while returning cleanup references to Pages.
Create-time provider/config failures and sanitize `pending`/`unavailable` states
return 409/503 and are retryable. Every other sanitize failure—including byte
read, decode, transform or final hosted-upload failure—is terminal 422 after
best-effort compensation. Pages must persist `cleanupProviderIds` from every
response that includes them, including a create-time 503. Delete waits at most
four seconds before returning 503 so Pages can queue the ID. Cleanup IDs go
directly into `gear_photo_deletions`; they are not round-tripped through the
stricter immediate delete endpoint.

The installed Wrangler/workerd/Miniflare build loads the real entry module but
does not expose hosted Images management methods, including `createDirectUpload`.
Cloudflare added those binding methods in September 2026. Before deployment, pin
a newer compatible toolchain and verify the real binding in isolated staging.
The Worker has a separate deploy and rollback path and remains undeployed.

No production image was uploaded during implementation. Deterministic tests use
mocked bindings and cover the direct-upload contract, stream inputs, exact byte
and dimension boundaries, scale-down dimensions, lossy/lossless/alpha WebP
container verification, quarantine gates, private upload enforcement and cleanup
compensation. Miniflare's offline image transformation did not complete a
disposable fixture in a bounded local run, so real transform/upload behavior and
signed URL generation remain isolated-staging launch checks.

The staging matrix must include JPEG orientation/GPS/ICC/comment metadata, PNG
text/EXIF/ICC metadata, WebP EXIF/XMP/ICC, animated WebP below and above 50 total
megapixels, HEIC and Display-P3 JPEG from a current iPhone, a sub-1600 image, a
12,000-by-2,000 image, finalize while still draft, an injected hosted-upload
timeout, concurrent double finalize, signed-delivery enforcement and the real
provider ID shape.

Current Cloudflare references:
[Direct Creator Upload](https://developers.cloudflare.com/images/upload-images/direct-creator-upload/),
[Images binding management](https://developers.cloudflare.com/images/storage/binding/),
[Images binding transformations](https://developers.cloudflare.com/images/optimization/binding/),
and [format/size limits](https://developers.cloudflare.com/images/get-started/limits/).

## Verification

```bash
node --test tests/gearImageUpload.test.mjs tests/gearPhotoQuarantine.test.mjs
node --test tests/gearImagesWorker.test.mjs tests/gearPagesPhotos.test.mjs tests/gearPagesPhotoManagement.test.mjs
node --check lib/gear-image-upload.mjs
node --check lib/gear-photo-quarantine.mjs
node --check gear-images/src/index.js
node --check lib/gear-pages-photo-service.mjs
node --check functions/api/gear/management/photos/upload.js
node --check functions/api/gear/management/photos/finalize.js
node --check lib/gear-photo-management.mjs
node --check functions/api/gear/management/photos/remove.js
node --check functions/api/gear/management/photos/reorder.js
GEAR_WRANGLER_MODULE=/usr/local/lib/node_modules/wrangler node scripts/gear/d1-check.mjs
git diff --check
```
