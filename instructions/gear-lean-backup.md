# Gear Exchange lean off-Cloudflare backup

Status: source-only runner and inactive schedule. The owner created the private
Backblaze bucket, restricted prefix key, 30-day lifecycle, offline `age` identity
and read-only Cloudflare D1 token. The encryption/decryption canary passed. No
GitHub secret, workflow activation or real Gear backup exists yet.

## Deliberate scope

This is proportionate recovery for a free community classifieds service. Each
night it preserves non-draft listings outside seller deletion/recovery, their
sellers and club selections, active owner-removal state with fixed generic text,
and active minimal seller-deletion evidence needed to block resurrection.

It deliberately excludes Cloudflare Images bytes and `gear_photos` metadata,
unverified drafts, verification/management/email-change credentials, contact
attempts and message copies, reports, moderation history, upload counters,
quarantines and the photo-deletion outbox. A disaster restore therefore produces
usable records with no photos and no live credentials. Sellers need new
management links and must upload photos again. This is an accepted simplicity
and cost tradeoff, not complete media disaster recovery.

Seller-deleted listings are excluded immediately rather than copied through
their recovery window. Live D1 and Time Travel remain the recovery mechanism for
an accidental seller deletion; the off-provider backup prioritizes permanent
privacy and anti-resurrection.

## Checked-in source

`lib/gear-lean-backup.mjs` creates and strictly validates the versioned logical
snapshot, reconciles fresh post-export deletion evidence, and restores only into
an empty, fully migrated database. Restore refuses an expired backup or an
existing target. Newer deletion evidence can be supplied when deliberately
restoring an older recovery point.

`scripts/gear/lean-cloud-backup.mjs`:

1. validates every environment value before contacting a provider;
2. polls the Cloudflare D1 SQL-export API for only the six source tables needed
   by the projection and downloads the result with a 256 MiB bound;
3. imports it only into an ephemeral runner database and creates the logical
   records-only snapshot;
4. queries current active deletion evidence and removes newly deleted listings;
5. encrypts JSON with `age` to an X25519 recipient whose private identity is
   never present in GitHub;
6. uploads ciphertext through the B2 Native API using a one-bucket, `gear/`
   prefix-scoped key whose exact capabilities are `readFiles` and `writeFiles`;
7. downloads the stored ciphertext by file ID and verifies the exact bytes;
8. removes runner temporary files whether the job succeeds or fails.

Successful stdout contains only backup ID, object name, times, byte count and
the fixed scope string. Provider failures are generic and never print credentials,
record content, signed export URLs or provider tokens.

`scripts/gear/lean-backup.mjs` verifies decrypted JSON, restores it to a new local
SQLite rehearsal database, or writes data-only SQL for a new D1 database after
migrations 0001–0018. The SQL path is tested against a freshly migrated temporary
database.

`gear-backup/github-actions.yml.example` is deliberately outside
`.github/workflows`; it cannot run. At activation time, review it again, copy it
to `.github/workflows/gear-records-backup.yml`, enable the 08:00 UTC nightly
schedule and set a GitHub Actions budget that prevents paid overage.

## Deployment-time provider setup

Do this only with explicit owner authorization:

1. Create a private Backblaze B2 bucket dedicated to Gear. Do not enable Object
   Lock. Configure lifecycle rules that permanently remove current and prior
   versions under `gear/` after 30 days; a hide marker alone is not deletion.
2. Create a B2 application key with the B2 CLI/API, restricted to exactly that
   one bucket and the `gear/` prefix, with exactly `readFiles` and `writeFiles`.
   The runner rejects every additional capability. B2 `writeFiles` can still
   hide objects; without Object Lock, a leaked key can therefore make recovery
   points disappear and lifecycle cleanup can make that loss permanent. This is
   an accepted limitation of the lean design, not immutable backup storage.
3. Generate an `age` X25519 identity offline. Put the private identity in the
   owner's password manager and one separate offline recovery copy. GitHub gets
   only the public `age1...` recipient.
4. Create a Cloudflare API token scoped to the production account with only the
   D1 permission required by export/query. Current token permissions are
   account-scoped, not database-scoped; try D1 Read first and, if export requires
   D1 Edit, record the risk acceptance before storing that more powerful token
   in GitHub. It receives no Workers, Pages, Images, DNS or account-administration
   permission. Confirm the available scope again during provider setup.
5. Add the seven values named in the workflow example as GitHub Actions secrets.
   Do not put their values in Git, workflow logs or the release record.
6. Run the workflow manually. Confirm the B2 object is private, read-back passes,
   lifecycle covers current and prior versions, and GitHub retains no plaintext.
7. Decrypt the first object on a trusted computer and complete the rehearsal
   below. Only then enable the nightly schedule.

GitHub's failed-workflow notification is the initial alert. There is no separate
dead-man service. Once a month, confirm a recent successful run and rehearse one
decryption. If usage or importance grows, missed-run monitoring and photo-byte
backup can be added as separately reviewed upgrades.

Cloudflare documents that D1 is unavailable to queries while an export runs.
The first staging run must measure that interruption; keep the nightly job at
08:00 UTC and leave scheduling disabled if the measured impact is unacceptable.

## Restore rehearsal

Download one ciphertext to a private working directory and decrypt it with the
offline identity:

```bash
age --decrypt --identity /private/path/gear-backup-identity.txt \
  --output /private/path/gear-backup.json /private/path/records-YYYY-MM-DD-ID.json.age
node scripts/gear/lean-backup.mjs verify /private/path/gear-backup.json
node scripts/gear/lean-backup.mjs restore /private/path/gear-backup.json /private/path/restored.sqlite
node scripts/gear/lean-backup.mjs sql /private/path/gear-backup.json /private/path/restore.sql
```

Use only temporary/local paths for routine rehearsal. Generated SQLite and SQL
contain seller emails and listing content, are mode 0600 and must be deleted when
the rehearsal ends.

Normally restore the newest valid backup. If an older backup is necessary,
download and decrypt every newer retained recovery point and append those JSON
paths to the `restore` or `sql` command. Their deletion evidence is applied before
any listing is restored.

This is a nightly recovery point, not continuous replication. A deletion, owner
removal or email change made after the newest successful backup can be lost in a
disaster. Before reopening traffic, re-apply any later action that can be
reconstructed from the surviving live system or operator/mail records.

Importing `restore.sql` into a new remote D1 database is a separately authorized
incident action. First create a new database, apply migrations 0001–0018, verify
it is empty, then use the documented D1 SQL import mechanism. Never import over
the original database or use this procedure as a production test.

After restore, verify public visibility, owner removals and deletion-ledger
blocks. Confirm all credential/contact/report/photo tables are empty. Issue new
seller access only through normal recovery mail after traffic is intentionally
enabled. Listings return without photos by design.

## Verification

```bash
node --test tests/gearLeanBackup.test.mjs
node --check lib/gear-lean-backup.mjs
node --check scripts/gear/lean-cloud-backup.mjs
node --check scripts/gear/lean-backup.mjs
git diff --check
```

Tests use temporary SQLite databases, synthetic records, a fake `age` operation
and mocked Cloudflare/B2 responses. They make no network request and use no real
secret or provider resource.
