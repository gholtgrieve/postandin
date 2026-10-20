# Coach Profiles

Status: **current core product**.

Coach Profiles provides a public directory and server-rendered profile pages for
Seattle-area hockey coaches.

## Public behavior

- `/coaches/` lists Live coaches.
- `/coaches/<slug>` serves a server-rendered profile.
- Live profiles are indexable and included in the sitemap.
- Draft profiles remain available for direct review, but are excluded from the
  directory and marked `noindex`.
- The directory offers the Airtable intake form as an optional submission path.

The Ian Doner and Max Doner profile templates include a hard-coded contextual
link to the [Felix Holtgrieve hosted aside](../asides/felix-profile/README.md)
because Felix has trained with both coaches. Keep that exception out of the
directory, homepage, global navigation, and shared footer.

The publication workflow is **Submitted → Draft → Live**. Intake submissions
are configured in Airtable to start as Submitted and have no profile page. The
owner moves a reviewed record to Draft for direct, `noindex` preview and then to
Live for publication. Because the Submitted default is externally managed,
verify it in Airtable when changing the intake form or publication workflow.

Coach publication has a manual static step. Whenever a coach changes between
Draft and Live, update both `sitemap.xml` and the crawlable fallback rows in
`coaches/index.html` in the same change. Those two lists must remain aligned and
must never contain Draft profiles; the client-side Airtable refresh does not
replace their search and no-JavaScript roles.

## Data flow

```text
Airtable
  -> Pages Function
  -> KV read-through cache
  -> directory API or server-rendered profile
```

Relevant routes:

- `GET /api/coaches`
- `GET /api/coach/<slug>`
- `GET /coaches/<slug>`
- `GET /coach-intake`

`/coach-intake` validates the configured `COACH_INTAKE_FORM_URL` and redirects
only to an HTTPS Airtable form. Missing or invalid configuration returns a
branded, `no-store`, `noindex` 503 response.

The directory and profile routes use the `GROUPS` KV binding through the shared
cache helper in `lib/kvCache.js`. Profile API and rendered-page reads share a
versioned profile cache key. Exact keys and field mappings must be verified
against the current functions before a change.

## Cache behavior

- Entries are fresh for five minutes and remain available as stale data for up
  to 24 hours.
- A stale entry is served immediately while the function attempts a background
  refresh. If that refresh fails, the stale value remains available.
- A cold cache calls Airtable directly, and an upstream failure is not cached.
  The JSON APIs return their generic `502` responses; the rendered profile route
  instead returns its uncached, `noindex` not-found page.
- A successful lookup with no matching Live or Draft profile may cache `null`;
  that is a real not-found result, not an upstream error.
- The directory cache stores the mapped public list. The shared per-profile
  cache stores the raw Airtable record, which each consumer maps for its own
  response.

Changing response fields or publication rules can require a cache-key version
bump. Keep the API and rendered-profile cache key identical.

## Security and privacy

- Airtable requests are server-side only.
- Never put the Airtable base ID, token, or other provider identifiers in tracked
  files.
- The directory API deliberately excludes every `contact_*` field. The
  per-coach API currently returns `contact_email`, `contact_phone`, and
  `contact_text` together with `contact_preference` without filtering those
  fields by preference. Only the rendered profile applies `contact_preference`
  when deciding which contact methods to display.
- Public responses must otherwise expose only intended profile fields.
- Upstream errors are logged server-side; browser responses use generic messages
  and never expose `e.message`, stack traces, binding names, or upstream URLs.

## Search visibility

The directory and Live profiles are part of the core public site. Changes to
profile publication state can affect the directory, server-rendered metadata,
API output, sitemap, and cache behavior together. See
[Routing and search visibility](../platform/routing-and-search.md).

## Verification

Run the relevant coach tests and the production health check. For frontend or
metadata changes, also inspect the directory and one Live and Draft profile at
mobile and desktop widths, check the console, and verify the sitemap and robots
behavior.
