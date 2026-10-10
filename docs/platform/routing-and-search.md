# Routing and search visibility

Status: **current policy**. Verify the actual HTML, `_headers`, `robots.txt`,
`sitemap.xml`, and deployed response together.

## Core product visibility

The homepage, all three Ice Time pages, Coach Profiles directory, Live coach
profiles, and Gear Exchange are public and indexable. Draft coach profiles and
private Gear owner surfaces remain unlisted and `noindex`.

Every HTML response for an unlisted or unfinished route must carry `noindex`,
including server-rendered not-found and other error responses. Applying the
directive only to the successful page can expose alternate responses to search.

## Hosted asides

- The Felix profile and its watch pages are indexable but deliberately absent
  from global navigation and feature directories.
- Seattle Junior Mets travel and statistics pages are direct-link, unlisted,
  omitted from the sitemap, and `noindex`.

These exceptions do not make the pages core Post & In products.

## Navigation policy

Launched navigation, homepage cards, footer links, and homepage metadata may
advertise launched core products. Unfinished sections must not appear on those
surfaces. `/pathway/` is intentionally deleted and must not be recreated or
linked without owner direction.

Coach Profiles is launched and remains linked from the homepage, schedule
pages, Coaches directory, and established public footers. Gear Exchange is
linked from the homepage card and homepage footer; do not infer that it should
be added to every product footer. Hosted-aside linking follows the exceptions
above and the [hosted asides policy](../asides/README.md).

## Social previews

The homepage, Gear Exchange, all three Ice Time pages, and the Coaches directory
use the shared 1200×630 `/social-preview-v2.png`, with page-specific titles and
descriptions. Server-rendered coach profiles use the coach headshot when one is
available and otherwise emit no social image.

Hosted asides own their preview policy. The Seattle Junior Mets travel page uses
its dedicated preview image, and the Felix profile and watch pages use their
approved profile media. Verify Open Graph and large Twitter Card metadata with
the other routing surfaces whenever a page or its visibility changes.

## Three-part model

| Mechanism | Purpose |
|---|---|
| `sitemap.xml` | Enumerates intended indexable URLs |
| `robots.txt` | Controls crawling; it does not reliably remove a URL from search |
| `noindex` metadata/header | Prevents indexing after a crawler can fetch the page |

Do not block a `noindex` page in `robots.txt`; the crawler must be able to read
the directive.

## Missing routes

`404.html` is required. Do not add a catch-all 200 redirect. Unknown paths,
`/about/`, and `/pathway/` must remain genuine missing URLs rather than serving
the homepage as a soft 404.

For a deleted page:

1. Verify the origin response with a cache-busting query string.
2. With explicit owner authorization, purge the exact deleted URL from the edge
   cache.
3. Verify the ordinary, non-query URL now returns a genuine `404`.

Static HTML has historically been observed with an `s-maxage` of seven days,
but response headers are external state. Inspect the deployed response instead
of assuming that value remains current.

## Public-file boundary

There is no build step. Any tracked file outside a protected runtime may become
reachable at a predictable Pages URL, including Markdown and other non-code
files. Treat the repository as public, verify deployed responses when adding a
new file class, and never store secrets or private personal information in
tracked files. `_headers` applies `X-Robots-Tag: noindex, nofollow` to every
served `*.md` path, including nested documentation. `noindex` reduces search
visibility; it is not access control.

## Routing-change verification

Check all of the following together:

- page metadata and canonical URL;
- `robots.txt`;
- `sitemap.xml`;
- `_headers` when relevant;
- `404.html`;
- one real unknown path and any deliberately deleted path;
- mobile and desktop rendering;
- browser console.

Do not add `lastmod`, `changefreq`, or `priority` without a process that keeps
the values accurate.
