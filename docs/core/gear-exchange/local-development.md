# Gear Exchange local development

Status: **current development guidance**.

## Static preview

Serving the repository as static files keeps Gear in sample-data mode. Posting,
verification, management, contact, and photos are simulated or temporary and
reset on reload.

```bash
python3 -m http.server
```

## Connected HTTPS preview

Use Node 24, OpenSSL, sample data, and a new temporary SQLite path:

```bash
node scripts/gear/local-preview.mjs /tmp/postandin-gear-connected.sqlite
```

Open `https://127.0.0.1:8773/gear/` and accept the locally generated self-signed
certificate. The preview does not modify the OS trust store. Never point local
tools at production data or place a sample database in the public repository.

The preview supports local posting, explicit verification, recovery, seller
management, email transfer, photos, buyer contact, reporting, moderation, and
lifecycle exercises through development-only adapters. No real email or cloud
deployment is implied.

## D1/workerd validation

The repeatable integration harness is documented in
[`reference/gear-d1-validation.md`](reference/gear-d1-validation.md). It requires
an existing Wrangler installation and does not provide a production migration
runner.

## Focused tests

Gear tests live under `tests/gear*.test.mjs`. Run the complete Gear set after
cross-cutting storage, route, lifecycle, or UI changes. Browser work requires
mobile and desktop checks, console inspection, and explicit failure-state
coverage.

Historical local-increment instructions are archived for context and are not the
current product or deployment contract.
