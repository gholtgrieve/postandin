# Gear Exchange production owner authentication

Status: source-only and not deployed. No Cloudflare Access application, custom
domain, environment value, owner identity or secret was configured by this
increment. Production moderation schema and action increments were added later;
see `gear-production-moderation.md`.

## Boundary

`lib/gear-access.mjs` validates the `Cf-Access-Jwt-Assertion` header that
Cloudflare Access adds to an allowed request. It does not trust the
`Cf-Access-Authenticated-User-Email` header or the browser's
`CF_Authorization` cookie by themselves.

Validation requires all of the following:

- HTTPS on exactly `gear-admin.postandin.com`;
- a three-part JWT using `RS256`, with a bounded `kid` and no critical extension;
- a signature from the current team-domain JWKS;
- the configured team-domain issuer and application audience;
- a present, unexpired `exp`, and valid optional `nbf`/`iat`, with 30 seconds of
  clock tolerance;
- an email in the exact configured owner allowlist.

The verifier uses Web Crypto and adds no dependency. It bounds tokens and JWKS
responses, caches plain JWK data for five minutes, and can refresh once when a
new `kid` appears so normal Access key rotation can succeed. Forced refreshes
are limited to one per team domain per minute. A genuinely new key can therefore
be denied for up to 60 seconds if a different unknown key triggered the most
recent refresh. It stores no request-specific identity globally and returns the
verified identity only to its caller.

`GET /api/gear/admin/session` is a source-only authentication probe. A valid
owner receives `{"authenticated":true}`; no identity or moderation data is
returned. Invalid tokens, identities, hosts and signatures get the same generic
403. Missing/malformed configuration and unavailable JWKS get a generic 503.
Every response is `no-store`, `no-referrer` and `nosniff`. The route performs no
writes and is not connected to the local owner UI.

Cloudflare's current documentation says an origin Worker must validate the
Access JWT even when Access protects the application, and recommends the
`Cf-Access-Jwt-Assertion` header because the cookie is not guaranteed to reach
the origin:
https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/

## Future deployment inputs

The Pages environment must eventually provide:

| Name | Meaning |
|---|---|
| `GEAR_ACCESS_TEAM_DOMAIN` | Full HTTPS team origin, such as the team's `cloudflareaccess.com` origin; no port is allowed. |
| `GEAR_ACCESS_AUD` | Audience tag for the dedicated Gear owner Access application. |
| `GEAR_OWNER_EMAILS` | Comma-separated exact owner-email allowlist using printable ASCII only. Configure as an encrypted secret because identities are private. |

Do not put real values in Git, sample files, logs or review prompts. Production
and preview environments must be configured separately. The Access application
must cover `gear-admin.postandin.com`, allow only the owner's chosen identities,
and enforce MFA at the identity provider/Access policy layer. This source code
does not provision or verify that external policy.

The team domain is restricted to a single `*.cloudflareaccess.com` team host.
The audience and allowlist must be present and syntactically valid; missing
configuration fails closed. Future moderation routes should call the same
verifier before reading or mutating private data. Header forwarding or an email
header alone is never authorization.

## Verification

```bash
node --test tests/gearAccess.test.mjs
node --check lib/gear-access.mjs
node --check functions/api/gear/admin/session.js
```

The tests generate temporary RSA keys in memory. They cover valid access, array
audiences, case-normalized exact owner matching, key caching and rotation,
wrong host/transport, missing and malformed tokens, wrong algorithms, critical
headers, bad signatures, wrong issuer/audience, expiration and not-before
boundaries, future issue time, non-allowlisted identities, missing configuration,
failed/malformed/oversized JWKS responses, forced-refresh throttling, Unicode and
whitespace identity rejection, redirect rejection, and generic route results.
They do not contact Cloudflare or use a real owner identity.

The final unmodified verifier and Pages handler were also exercised in local
Miniflare/workerd from Wrangler 4.107.0. A mocked JWKS endpoint confirmed a valid
owner response, cache reuse, generic denials for wrong audience and identity,
the 60-second unknown-key cooldown, and a generic 503 without following a JWKS
redirect. The complete Gear suite passes 112 tests.

Before launch, repeat the checks in a non-production Access application with an
explicit test identity, confirm that Access strips/replaces spoofed assertion
headers, and verify the custom-domain policy and MFA through a real browser. That
staging exercise requires separate owner authorization and is not implied by the
source-only tests.
