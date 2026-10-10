# Felix Holtgrieve profile

Status: **hosted aside; not a Post & In product**.

`/felix-holtgrieve/` is an indexable player profile and video library hosted on
the Post & In site for convenience. It is deliberately absent from the homepage,
global navigation, footers outside the profile, and product directories.

Each clip can have an indexable watch page under
`/felix-holtgrieve/video/<clip-id>/`. `felix-holtgrieve/clips.js` is the reviewed
manifest, and the profile modules render filters, previews, and on-demand clips.

## Media workflow

The source game and generated media stay outside the public repository. The
local processing workflow uses R to coordinate FFmpeg and can publish reviewed,
versioned outputs to the dedicated media host through authenticated Wrangler.

See [Felix clip workflow](media-workflow.md).

## Privacy and publication

- Do not commit source footage, official academic records, credentials, or
  private identifiers.
- Treat all published profile facts and media as public.
- Keep canonical, social, structured-data, watch-page, and sitemap metadata in
  sync with the reviewed content.
- Preserve the deliberate separation from core Post & In navigation and feature
  documentation.
