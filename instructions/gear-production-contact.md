# Gear Exchange production buyer-contact boundary

Source-only production backend on `codex/gear-exchange-foundation`. The public
contact button remains disabled. No D1 binding, Turnstile action, Resend key,
edge rule, mail, production data or deployment is created by this increment.
The route also fails closed unless `GEAR_CONTACT_ENABLED` is exactly `true`, so
shared posting/verification bindings and secrets cannot enable contact by accident.

## Contract

`POST /api/gear/contact` accepts same-origin JSON with:

```json
{
  "id": "listing UUID",
  "requestId": "new browser-generated v4 UUID",
  "name": "Buyer",
  "email": "buyer@example.test",
  "message": "Plain-text message",
  "shareEmail": true,
  "adult": true,
  "turnstileToken": "gear-contact token"
}
```

The bounded request parser rejects cross-origin, non-JSON, malformed and
oversized bodies before Turnstile or D1. Name is 1–60 characters, message is
1–2000 characters with normal line breaks allowed, email uses the shared
normalizer, and both email-sharing and 18-or-older acknowledgements must be the
literal boolean `true`. The Turnstile result must be for `postandin.com` and the
dedicated `gear-contact` action.

One D1 batch records a hashed-buyer attempt and, only for a currently public
verified listing/seller, a private delivery copy addressed to the seller email
current at submission. The request UUID is the durable idempotency key. An exact
replay reuses the same record; a UUID reused with different content is rejected.
Rolling ten-minute limits are three attempts per buyer/listing, five per buyer
and 60 globally. Malformed or unconfigured requests do not count; eligible and
ineligible verified submissions do. No IP address is stored, so the required
Cloudflare edge IP limit remains a launch item.

The Resend adapter fixes the sender to `Post & In Gear <gear@postandin.com>`,
sends only plain text to the current seller, and sets the normalized buyer email
as Reply-To. The provider idempotency key is derived only from `requestId`.
Success is returned only after Resend acceptance and a durable sent receipt, or
for a replay already marked sent. A lost receipt can safely retry the same UUID.
Responses never include seller/buyer addresses or message text.

Delivery first claims the private copy for 60 seconds and atomically rechecks
that the listing and seller remain public, verified, unexpired and addressed to
the same seller email. A simultaneous request receives `503` with
`Retry-After: 60` and must retry the same request UUID. Other temporary `503`
responses also retry the same UUID. A `409` instructs the client to start over
with a new UUID, while `404` means contact is no longer available. Idempotent
retries are retained for 24 hours; after that boundary the client must start a
new request. In the rare case that provider delivery succeeds but the local sent
receipt cannot be recorded, a later retry can be refused if the listing becomes
ineligible or the seller address changes, even though the original email may
already have been accepted.

Private contact copies become due after exactly 24 hours. Hashed attempt rows
become due after exactly ten minutes. The next scheduled maintenance pass removes
both, so physical deletion can occur up to one schedule interval later; seller listing
purge cascades any remaining message copy. These tables are included in local
schema upgrades, temporary D1/workerd coverage and the existing maintenance
operation budget.

## Verification

```bash
node --test tests/gearPagesContact.test.mjs tests/gearProductionFoundation.test.mjs tests/gearProductionMaintenance.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --test tests/gear*.test.mjs
git diff --check
```

All tests use synthetic addresses, injected provider responses and temporary
databases. Enabling the button, creating a Turnstile widget action/edge rule,
configuring D1 or Resend, explicitly enabling contact, staging allowlisted delivery and deploying remain
separate explicitly authorized work.
