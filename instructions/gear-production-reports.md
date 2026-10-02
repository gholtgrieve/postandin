# Gear Exchange production report submission

Status: source-only and not deployed. The exact-production-origin Gear UI is
connected behind an explicit feature gate and a dedicated Turnstile widget, but
no site key, secret, feature flag, Cloudflare rate-limit rule, D1 binding,
remote migration or production route was configured by this increment. The
static demo and connected local workflow remain unchanged.

## Public boundary

`POST /api/gear/reports` accepts JSON containing:

- `id`: the listing UUID;
- `reason`: one of the four shared `REPORT_REASONS` values;
- `turnstileToken`: the short-lived client response from the dedicated
  Turnstile widget configured with action `gear-report`.

The handler requires its request URL and `Origin` to be exactly
`https://postandin.com`, rejects `Sec-Fetch-Site: cross-site`, accepts only JSON
and reads at most 4 KiB including streamed bodies. Invalid request shapes never
call Turnstile or D1. Unknown client fields are discarded.

The server validates every token at Cloudflare Siteverify with the secret from
`GEAR_TURNSTILE_SECRET`. Tokens are limited to 2,048 printable ASCII characters;
the verifier requires successful hostname `postandin.com` and action
`gear-report`, rejects redirects, bounds the response to 16 KiB and times out
after five seconds. It uses a random idempotency key. It does not send the
visitor's IP address, and neither token nor IP is logged or stored. Invalid,
expired and replayed tokens receive the same generic retry response. Missing
secret, network/service errors and malformed responses fail closed with a
generic 503.

Cloudflare documents that Turnstile tokens must be validated server-side, are
single-use and expire after five minutes:
https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

## Storage and behavior

The public config advertises `reportEnabled: true` only when `GEAR_DB`, a valid
Turnstile secret and the exact `GEAR_REPORTS_ENABLED=true` flag are present. The
report route independently requires the same exact feature flag before calling
Turnstile or D1, so bypassing the UI cannot activate a disabled route.

After Turnstile succeeds, one bound `INSERT ... SELECT` statement checks that
the listing and seller are verified, the listing is available or pending, and
expiry is strictly after the submission time. The same statement inserts a
generated report ID, listing ID, current title snapshot, shared reason and
millisecond timestamp into `gear_reports`; resolution uses its `open` default.
An unavailable listing returns a generic 404. No listing, seller, verification,
expiry or moderation state changes, and no automatic moderation action occurs.

The response is `no-store`, `no-referrer` and `nosniff`. Expected public errors
never expose the binding name, Siteverify details, SQL or exceptions.
If the browser cannot confirm a response, the form preserves the selected reason,
requires a fresh single-use token and warns that retrying may submit a duplicate.
Reports never take automatic action, so an unavoidable duplicate is limited to
owner review-queue noise and can be dismissed there.

## Deployment gates

Before the connected UI and route can be launched, the owner must separately
authorize and configure:

1. a Turnstile widget restricted to `postandin.com`; the source uses action
   `gear-report` and validates that exact action server-side;
2. the public site key in the UI and `GEAR_TURNSTILE_SECRET` as an encrypted
   Pages secret in production; ordinary Pages preview hosts are intentionally
   denied by the exact-origin guard, and any future staging host requires a
   separately reviewed source/configuration change;
3. a Cloudflare edge rate-limit rule scoped to the report endpoint, verified to
   challenge or block abusive clients before they consume Worker/Siteverify/D1
   work;
4. migrations 8–9 and the `GEAR_DB` binding under the separately reviewed
   deployment/rollback procedure;
5. the exact `GEAR_REPORTS_ENABLED=true` environment flag, only after the
   preceding controls have been verified. Omitting it keeps both UI and route
   disabled.

Turnstile is necessary but does not replace rate limiting. No reporter IP is
stored in application data. Exact rule availability and thresholds must be
confirmed against the owner's Cloudflare plan during deployment configuration.

## Verification

```bash
node --test tests/gearPagesReportSubmission.test.mjs tests/gearProductionReportUI.test.mjs tests/gearProductionPostingUI.test.mjs tests/gearPagesModeration.test.mjs tests/gearAccess.test.mjs tests/gearProductionFoundation.test.mjs tests/gearPagesListings.test.mjs
GEAR_WRANGLER_MODULE=/absolute/path/to/wrangler node scripts/gear/d1-check.mjs
node --check lib/gear-turnstile.mjs
node --check lib/gear-report-storage.mjs
node --check functions/api/gear/reports.js
node --check tests/gearPagesReportSubmission.test.mjs
GEAR_PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/gear/browser-production-contact-check.mjs
git diff --check
```

Focused tests cover atomic current-visibility insertion, exact expiry, stored
field privacy, exact host/Origin, cross-site, content type, malformed and
declared/streamed oversized bodies, invalid UTF-8, Turnstile token bounds,
configuration/hostname/action diagnostics, timeout, redirect/network/service
and malformed/oversized response failures, exact feature gating, real
route-verifier wiring, missing D1, safe eligibility and database failures,
adapter response validation and security headers. The isolated browser harness
checks the enabled and disabled UI paths and the separate `gear-report` action.
Tests use temporary databases, fictitious identities and mocked Siteverify
responses; they make no real network call.
The existing nine-migration workerd harness also exercises successful and
ineligible atomic report insertion through an actual local D1 binding.
