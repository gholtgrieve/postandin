# Development and testing

Status: **current shared guidance**.

## Local servers

Static pages only:

```bash
python3 -m http.server
```

Pages Functions:

```bash
npx wrangler pages dev .
```

The Pages compatibility date is externally managed. Verify and pass it
explicitly when runtime parity matters.

Gear's connected local preview has separate instructions in
[Gear local development](../core/gear-exchange/local-development.md).

## Baseline checks

```bash
node --test tests/*.test.mjs
git diff --check
```

Run `node --check` on changed JavaScript files that Node can parse.

## Risk-based checks

| Change | Additional verification |
|---|---|
| Schedule or scraper | Relevant tests plus `node scripts/audit-rinks.js` |
| Public deployment health | `node scripts/health-check.js` |
| Frontend | Mobile and desktop browser checks, keyboard path, console |
| API | Success, bad input, authorization, and upstream failure |
| Routing/visibility | Metadata, robots, sitemap, headers, 404, unknown path |
| Gear storage/routes | Focused Gear tests and temporary sample databases |
| Worker/shared imports | Syntax/tests plus independent deployment impact review |
| Documentation | Local-link validation, rendered structure, and command review |

The audit and health scripts are live, read-only checks. Do not claim a check
passed if it could not run; report the limitation and remaining manual work.

## Public errors

Test that public failure responses remain generic. Never expose `e.message`,
stacks, upstream URLs, credentials, provider identifiers, or binding names.
Keep detailed diagnostics server-side.
