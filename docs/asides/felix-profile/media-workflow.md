# Felix clip workflow

This workflow processes one clip from one full-game video. It deliberately keeps
the source game and every generated media file outside the public repository.
R only coordinates the job; FFmpeg performs the video work.

## One-time setup

This Mac is Intel and runs macOS 13 Ventura. Current Homebrew FFmpeg bottles are
not published for that combination, so `brew install ffmpeg` may attempt a slow
source build. Use the official Ventura installer from MacPorts instead, then run:

```sh
sudo port install ffmpeg7
```

MacPorts installs this port at `/opt/local/bin/ffmpeg7`; the R script checks that
location even when RStudio does not include it in `PATH`. The R script otherwise
uses base R and requires no packages.

## Process one clip

In R or RStudio, first load the function from the repository:

```r
source("scripts/process-felix-clip.R")
```

Then run one clip. The start and end values may use `HH:MM:SS`, `MM:SS`, or
plain seconds. For example, 47 minutes and 39 seconds is `47:39`; `47:39:00`
means 47 hours and 39 minutes. Clips are limited to 60 seconds so the complete
hover preview stays lightweight for visitors.

```r
crop <- choose_felix_crop(
  input = "/Users/your-name/Movies/full-game.mp4",
  start = "01:12:34.5"
)

felix <- choose_felix_position(
  input = "/Users/your-name/Movies/full-game.mp4",
  start = "01:12:34.5",
  crop = crop
)

offensive_zone <- choose_felix_position(
  input = "/Users/your-name/Movies/full-game.mp4",
  start = "01:12:45",
  crop = crop
)

process_felix_clip(
  input = "/Users/your-name/Movies/full-game.mp4",
  start = "01:12:34.5",
  end = "01:12:52",
  id = "2026-10-05-breakout-pass",
  title = "Breakout pass under pressure",
  categories = c("puck-movement", "offensive"),
  opponent = "Opponent name",
  date = "2026-10-05",
  output_dir = "/Users/your-name/Movies/felix-clips",
  felix_position = felix,
  crop = crop,
  marker_radius = 0.07,
  secondary_highlight_time = "10.5",
  secondary_felix_position = offensive_zone
)
```

`choose_felix_crop()` opens the first clip frame in the R plot pane. Click two
opposite corners around the useful game area. The function adjusts the selected
area to a 16:9 frame so the video remains compatible with the existing cards
and watch pages. Omit `crop` from the later calls when the full frame is useful.

`choose_felix_position()` opens the cropped first clip frame in the R plot pane. Click
the center of Felix once. The generated poster and both videos use that position
for a mustard circle. The opening frame pauses for 1.75 seconds with the marker
visible, then the marker disappears and the play begins normally.
The optional `marker_radius` is measured as a fraction of the output height and
defaults to `0.07`. Increase it for a tightly cropped clip when the reviewed
marker needs to encircle more of the player.

The optional `secondary_highlight_time` is measured from the clip start, not
from the full game's beginning. In the example, `01:12:45` is 10.5 seconds after
the clip starts at `01:12:34.5`. Select Felix on that full-game frame with a
second `choose_felix_position()` call, then pass its result as
`secondary_felix_position`. The generated videos briefly pause for 1.25 seconds
and show the circle again at that point. Omit both secondary arguments when a
clip needs only the opening identification.

Allowed categories are `defensive`, `offensive`, `puck-movement`, and
`special-teams`. Use a character vector when the same clip belongs in more than
one filter.

### Process one synchronized two-angle clip

When the same play was recorded from two cameras, use
`process_felix_stacked_clip()` to create one top-and-bottom video with one audio
track and one set of browser controls. This remains a single-clip workflow; it
does not process a directory or batch of games. Select each crop independently,
and measure `secondary_start` from the second source file:

```r
primary_crop <- choose_felix_crop(
  input = "/Users/your-name/Movies/mid-ice.mp4",
  start = "01:12:29"
)

felix <- choose_felix_position(
  input = "/Users/your-name/Movies/mid-ice.mp4",
  start = "01:12:29",
  crop = primary_crop
)

secondary_crop <- choose_felix_crop(
  input = "/Users/your-name/Movies/behind-net.mp4",
  start = "02:09.638"
)

process_felix_stacked_clip(
  primary_input = "/Users/your-name/Movies/mid-ice.mp4",
  secondary_input = "/Users/your-name/Movies/behind-net.mp4",
  start = "01:12:29",
  end = "01:12:38",
  secondary_start = "02:09.638",
  id = "2026-10-18-goal-from-the-slot",
  title = "Scores from the slot",
  categories = c("offensive"),
  opponent = "Opponent name",
  date = "2026-10-18",
  output_dir = "/Users/your-name/Movies/felix-clips",
  felix_position = felix,
  primary_crop = primary_crop,
  secondary_crop = secondary_crop,
  highlight_seconds = 2
)
```

The primary angle supplies the card poster, muted hover preview, and full clip
audio. A separate stacked poster shows both angles before the full clip starts.
The full clip places the primary angle on top of the synchronized secondary
angle. Both full-clip panels freeze together during the opening identification
pause, but the mustard circle marks Felix only in the primary panel. Both angles
then play simultaneously for the same duration. The processor checks that both
source files cover the requested range before encoding. Confirm synchronization
with a shared visual or audio event before publishing.

The output directory receives four files for a single-angle clip; synchronized
clips add a fifth:

- `<id>-preview.mp4`: silent 360p version of the complete play, looped by the
  page while the card is hovered or keyboard-focused;
- `<id>.mp4`: marked pause followed by the full timestamp range, at up to 720p
  for one angle or 1280×1440 for synchronized top-and-bottom angles;
- `<id>.jpg`: marked opening frame shown on the profile card;
- `<id>-watch.jpg`: synchronized two-angle opening frame for full playback,
  created only by the two-angle processor; and
- `<id>-clip-entry.js`: starting metadata for `felix-holtgrieve/clips.js`.

FFmpeg seeks to the clip start before decoding, so it does not reprocess the
whole game. The single-angle outputs use the `veryfast` H.264 preset for an
older Intel Mac. The larger two-angle full clip uses the `medium` preset at CRF
23 to keep its published file size practical.

## Publish it with Cloudflare R2

Post & In uses the existing Cloudflare account with a dedicated Standard-class
R2 bucket named `postandin-media` and the custom domain
`media.postandin.com`. It does not need another Worker or database. R2 Standard
is intentional because its free allowance applies to storage and requests, and
R2 does not charge internet egress. Actual use and billing still need to be
checked in the Cloudflare dashboard.

After processing one clip, publish its media files from R. A single-angle clip
has three media files; a synchronized clip adds the separate full-player poster.
Supply an explicit version every time:

```r
publish_felix_clip(
  output_dir = "/Users/your-name/Movies/felix-clips",
  id = "2026-10-05-breakout-pass",
  season = "2026-27",
  version = "v1"
)
```

The function uses the locally authenticated Wrangler command, uploads directly
to R2 with the correct media types, and assigns a one-year immutable cache
header. It then replaces the placeholder URL in `<id>-clip-entry.js` with the
public media URL. No Cloudflare credential is stored in R or this repository.

Published keys use this versioned pattern:

```text
felix/<season>/<clip-id>/<version>/<filename>
```

Never replace media at a published version. If a clip is regenerated, publish
it as `v2`, `v3`, and so on, then update the page entry. This avoids cache
purges. The function checks for an existing poster before uploading and stops
when a version is already in use. If Wrangler cannot complete that check
because of a login, network, or service error, publishing also stops.
`overwrite = TRUE` is reserved for retrying the exact same generated files
after a partial upload failure.

Before pasting the generated object into `felix-holtgrieve/clips.js`, add:

- `internalRank`: an integer from 1 to 10; higher-scored clips appear first,
  and tied clips retain their order in the manifest;
- `description`: a plain-language account of the visible play that identifies
  Felix and the opponent; keep the game date in the separate date metadata;
- `uploadDate`: the first publication time for the current versioned clip URL
  in ISO 8601 format, including its timezone;
- `durationSeconds`: the published full clip's duration from `ffprobe`.
- `pageSrc`: the root-relative URL for the clip's dedicated watch page.

Add a server-delivered fallback card to `felix-holtgrieve/index.html`, update
the season clip count, and place the card in the same ranked position as the
manifest-driven library. Create a dedicated page at
`felix-holtgrieve/video/<clip-id>/index.html`. The fallback card must link to
that watch page. The watch page must embed the full clip as its primary content
and include matching `VideoObject` metadata. Include the `data-custom-controls`
and `controls` attributes on its video, load `watch-controls.css`, and load
`watch-controls.js` as a module so custom controls replace the native overlay
while native controls remain available if JavaScript fails. Increment the
control assets' `?v=` value on the profile and every watch page whenever either
control file changes. Use the full clip for `contentUrl`,
the marked poster for `thumbnailUrl`, and the same title, description,
publication time, and duration shown to users. Add the watch page URL to
`sitemap.xml`, then preview the profile and watch page locally and run:

Use `watchPosterSrc` for the watch page's `<video poster>` when it is present,
falling back to `posterSrc` for single-angle clips. Keep `posterSrc` as the
card image and as the `og:image` and `thumbnailUrl` value.

Whenever `clips.js` or `profile.js` changes, increment the shared `?v=` value
in both the `profile.js` script URL in `index.html` and the `clips.js` import in
`profile.js`. Production JavaScript can otherwise remain cached for four hours.

```sh
Rscript tests/felixClipProcessing.test.R
node --test tests/felixProfileVisibility.test.mjs
```

Do not put full-game files or generated `.mp4` files in this repository. The
profile test also rejects tracked video files under `felix-holtgrieve/`.
The R2 media bucket is not a backup. Keep the original game files and the clip
timestamps in local storage so a published clip can be recreated if needed.
