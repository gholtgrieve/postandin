# Gear Exchange persistent local photos

September 27, 2026. Local sample-data implementation, based on `7753fa2`.
No deployed image service, R2 bucket, Pages route or production migration.

## User flow

Start the HTTPS preview documented in `gear-connected-preview.md`. Publish and
sign in, then choose **Photos** on a managed listing. Upload one image at a time,
choose **Make main**, or remove an image. Changes save immediately, independently
of the listing edit form. The first image appears in browse; detail provides a
photo picker. Up to six photos are allowed. Uploading during initial draft
creation is deliberately deferred; the posting form explains this sequence.
The ordinary static demo continues to use temporary browser previews.

## Storage and sanitization

`scripts/gear/local-photos.mjs` is Node/macOS-only tooling. It uses the existing
system `/usr/bin/sips` decoder, with no npm dependency. PNG, JPEG and WebP inputs
must have a recognized signature, valid canonical base64, at most 5 MiB, at most
25 million pixels and no side above 12,000 pixels. Each probe/conversion has a
15-second timeout. The trusted process re-encodes PNG pixels with a maximum
1600-pixel side, resizing only when needed so smaller images stay unchanged
in size. A bounded EXIF/TIFF orientation reader handles all eight rotations and
mirrors before metadata removal (JPEG APP1, PNG eXIf, WebP EXIF). Only IHDR, PLTE, tRNS, IDAT and IEND chunks are retained; original
EXIF, comments, profiles and other ancillary metadata are discarded. Originals
exist only in a private temporary directory and are removed in `finally`.
Output is bounded at 12 MiB. Decoder failures return generic messages.

Local-server startup creates `gear_local_photos` in the existing sample SQLite
database. It holds a UUID, listing foreign key, position, sanitized PNG bytes and
creation time. This is a **local-only additive table**, not a seventh D1 migration.
It persists with the database and requires no separate media directory. The six
shared D1 migrations are unchanged; the D1 harness does not validate photo storage.
Never import this module into a Worker or treat database BLOBs as the production
image architecture. A portable trusted encoder and private object storage remain
future work. No record/photo backup or restore guarantee is provided.

## Access and HTTP contract

- `POST /management/photos` accepts JSON `{id, action, data? , photoId?}`.
  Actions are `upload` (base64 data), `main`, and `remove`. The route requires the
  same exact Origin, unique management cookie and CSRF token as other writes.
  Its body limit is 7 MiB; other JSON routes remain limited to 32 KiB.
- Only the verified listing's current owner can mutate photos; unverified and
  removed listings cannot be changed. Closed/expired listings can retain and
  manage photos. Session/CSRF/ownership and the six-image quota are checked again
  after asynchronous decoding inside the write transaction. Concurrent uploads
  cannot overfill the listing. Original names, paths and metadata are not stored.
- `GET /photos/<uuid>` serves a PNG only while its listing and seller are verified,
  status is available/pending and expiry is in the future. Closing, removing or
  expiring a listing makes the same public URL return 404.
- `GET /management/photos/<uuid>` requires the current owner session, including
  for inactive listings. The cookie's existing `/management` path is preserved.
- Public and management listing responses receive ordered photo IDs/URLs. Image
  responses use no-store, no-referrer and nosniff. Neither route serves arbitrary
  paths. Ownership follows the listing through email transfer; old sessions lose
  access. Deleting a photo removes its database row and bytes in the transaction.

The local tool is for one operator with sample images. There is no shared-service
rate limiting, background processing, thumbnail cache, upload idempotency or
storage quota beyond per-file/per-listing limits. An uncertain upload can require
refreshing before retry to avoid attaching the same image twice. Real deployment
needs resource isolation and abuse controls; client-side processing alone does
not replace trusted re-encoding.

## Verification and handoff

Photo sanitizer tests require macOS with `/usr/bin/sips`; they do not run on
other platforms.

```bash
node --test tests/gearPhotos.test.mjs tests/gearConnectedPreview.test.mjs tests/gearEmailChange.test.mjs tests/gearManagement.test.mjs tests/gearVerification.test.mjs tests/gearStorage.test.mjs tests/gearExchange.test.mjs tests/gearPreviewVisibility.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-preview-check.mjs
```

Observed: all 61 Node tests and the expanded HTTPS Chrome harness pass.
Syntax and diff whitespace checks pass. Desktop and mobile screenshots were
inspected.

New tests cover pixel re-encoding/metadata stripping, malformed/spoofed uploads,
owner and CSRF rejection, unverified listings, six-photo limits including
concurrent decoding, session revocation during decoding, reordering/deletion,
restart persistence, inactive privacy, email-transfer access, Origin and body
limits. The HTTPS browser harness uploads real PNG data, chooses a main image,
removes an image, restarts the server, checks public/private image access and
detail rendering, and checks desktop/390/320px layout and console errors.

Review baseline: `7753fa2`; compare with the photo increment, including this
file, `scripts/gear/local-photos.mjs` and `tests/gearPhotos.test.mjs`. Claude review found no security/access/transaction defects and two image-quality
issues. Upscaling and EXIF orientation are now fixed with dimension and actual
pixel-placement regression tests for all eight orientations. Stale docs were
corrected. Optional color-profile conversion and UI polish remain deferred.
Focused Claude re-review found no blocker/high/medium defects and concluded
ready for local macOS sample-data use. Both original image issues are resolved.
The recommended big-endian TIFF orientation-6 regression is now included and
passes: portrait dimensions, exact pixel placement and EXIF removal are checked.
All five focused photo tests pass after this test-only addition; application
code is unchanged. PNG/WebP orientation fixtures remain additional coverage gaps.
Included in the local commit `Add persistent photos to local Gear management`;
use Git history for its hash. No push, merge or deployment.
