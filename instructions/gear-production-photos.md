# Gear Exchange production photo pipeline

Status: source-only foundation and not deployed. No route, Images binding,
delivery variant, signed-delivery key or production resource is configured.

## Private quarantine and trusted sanitization

`lib/gear-image-upload.mjs` implements the provider-facing portion of the
owner-approved workflow:

1. The future authenticated route asks Cloudflare Images for a Direct Creator
   Upload URL that expires after ten minutes. The object is marked only as a
   Gear quarantine object and requires signed delivery.
2. The browser uploads the original directly to that private quarantine. The
   original is temporarily stored by Cloudflare, but is never published or
   attached to a listing.
3. The future finalize route passes the quarantine provider ID to the adapter.
   The adapter downloads the actual bytes, enforces a 5 MiB streaming limit, and
   requires Cloudflare Images to decode an image no larger than 24 million
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
objects discoverable. Scheduled reconciliation must list `purpose:gear-photo`
objects and, after a grace period, delete any object absent from both `gear_photos`
and an in-flight finalization record.

## Route and lifecycle requirements for the next slice

The adapter is intentionally below authorization and D1. The next slice must:

- require the existing seller management session and CSRF protection on both
  upload creation and finalization;
- bind each quarantine ID to that seller and listing at issuance, then consume
  that binding exactly once after successful finalization so another seller
  cannot finalize or delete it; `pending` means the browser upload has not
  finished and `unavailable` is retryable, so neither consumes the binding;
- recheck listing ownership, listing state and the six-photo limit after the
  asynchronous transform, before attaching the sanitized provider ID;
- transactionally attach the sanitized provider ID or immediately delete/enqueue
  it if D1 attachment fails;
- delete or enqueue the original quarantine on every terminal failure, and let
  scheduled maintenance find and purge abandoned/expired quarantine records;
- reconcile unreferenced sanitized images by their fixed purpose/source metadata
  so a provider commit followed by an exception or Worker loss cannot retain an
  image indefinitely;
- keep removal and reorder ownership-checked; and
- project only short-lived signed URLs for the configured public variant.

No original filename, user-provided metadata, image bytes, upload URL or signed
delivery URL belongs in D1. Provider IDs are cleanup references, not credentials.

The current local Wrangler/workerd/Miniflare build does not implement hosted
Images `createDirectUpload`, despite the method being in the current Cloudflare
binding documentation. The route increment must first pin a compatible toolchain
and compatibility date. Cloudflare Pages Functions do not expose an Images
binding, so the image endpoints should live in a small dedicated Worker reached
from Pages through a service binding. That Worker has a separate deploy and
rollback path; neither is created or deployed in this slice.

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
node --test tests/gearImageUpload.test.mjs
node --check lib/gear-image-upload.mjs
git diff --check
```
