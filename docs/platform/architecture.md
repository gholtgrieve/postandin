# Platform architecture

Status: **current overview**.

Post & In is intentionally a small vanilla HTML, CSS, and JavaScript system. Its
three core products are Ice Time, Coach Profiles, and Gear Exchange. Hosted
asides share the static hosting platform but are not product components.

## Runtime topology

```text
Users
  -> Cloudflare Pages
       ├── static HTML, CSS, JavaScript, and images
       ├── Pages Functions under functions/
       └── shared runtime modules under lib/

Independent Cloudflare Workers
  ├── group-do          Groups membership and RSVPs
  ├── scheduler         schedule collection and Groups backup
  ├── gear-maintenance  retention, retry, and reconciliation
  └── gear-images       private image-provider operations
```

## Core products

### Ice Time

The three schedule shells share the modules and stylesheet under
`stick-and-puck/`. The scheduler writes activity-specific caches to KV, and the
Pages schedule route serves them with a scoped live fallback.

### Coach Profiles

Pages Functions read coach records from Airtable through a KV read-through
cache. The directory uses a JSON endpoint, and profile URLs are server-rendered
for metadata and crawlability.

### Gear Exchange

Pages Functions coordinate D1, Turnstile, Resend, seller sessions, and the
private Images service. Separate Workers handle trusted image operations and
scheduled maintenance. A GitHub Actions workflow creates the encrypted
records-only backup.

## Shared code

- `functions/` contains Pages request handlers.
- `lib/` contains server and shared-domain modules.
- `tests/` contains Node tests and fixtures.
- `migrations/gear/` contains additive Gear D1 migrations.
- Root static directories map directly to public URL paths.

The codebase is the source of truth for exact imports, routes, schemas, cache
keys, and bindings.

## Hosted asides

Seattle Junior Mets and Felix profile pages use the Pages release path and may
use dedicated scripts or workflows. They do not belong in core product diagrams,
priorities, or status summaries unless a change affects shared platform behavior.

See [Hosted asides](../asides/README.md).
