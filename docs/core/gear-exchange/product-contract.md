# Gear Exchange product contract

Status: **current owner-approved product boundary**.

## Scope

Gear Exchange supports local adult classifieds for **For Sale**, **Trade**, and
**Free** hockey gear. Protective gear is allowed.

It does not provide checkout, shipping, dealer listings, ratings, or an
anonymous two-way relay.

## Listing rules

- Description is required and covers wear, repairs, damage, and unknown history.
- Condition is selected separately.
- A listing may contain up to six photos and one chosen main photo.
- A seller may have at most ten active listings, including pending listings.
- Listings expire after 30 days.
- Publication requires email verification.
- Seller management uses revocable private credentials and authenticated
  sessions.
- Location is a city, not a rink or a pickup arrangement.
- Size choices include **One size** and **Mixed sizes**.
- Club branding is optional and may include several clubs. **Other** has a
  separate custom-name field: typing a name selects Other, selecting Other
  requires a name, and clearing Other clears the custom name.

`lib/gear-exchange.mjs` owns shared categories, sizes, conditions, listing types,
clubs, limits, and public search behavior. Client and server controls must use
the same choices. `lib/gear-validation.mjs` owns server content validation.

## Search and pricing

- City comparison normalizes casing and whitespace.
- Do not infer a region from arbitrary city text.
- Spelling aliases and geocoding are deferred.
- Prices use integer cents.
- A maximum-price filter includes Free at zero and excludes unpriced trades.
- Custom club names participate in search; the Other filter includes custom
  club records.

## Lifecycle

Closed listings may be relisted and expired listings may be renewed, subject to
current limits and duplicate checks. Seller deletion hides a listing immediately
and provides a 30-day recovery window before permanent cleanup. Owner moderation
and deletion can revoke access. A listing cannot be renewed while removed; a
seller-deleted listing must first pass the separate recovery flow, while owner
moderation can continue to block restoration. Exact state transitions and
retention rules are enforced by the current storage and route implementations.

## Privacy and safety

- Seller email is private.
- Buyer contact discloses that the buyer email will be shared with the seller.
- Public fields are allowlisted at the server boundary.
- Photos are validated, re-encoded, stripped of metadata, and privately managed
  before signed public delivery.
- Public writes use explicit feature configuration, exact-origin checks,
  Turnstile where applicable, durable limits, and edge rate limiting.

Changes to these product, UX, policy, or copy decisions require owner direction.
