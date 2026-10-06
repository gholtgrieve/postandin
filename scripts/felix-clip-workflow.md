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
means 47 hours and 39 minutes.

```r
felix <- choose_felix_position(
  input = "/Users/your-name/Movies/full-game.mp4",
  start = "01:12:34.5"
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
  felix_position = felix
)
```

`choose_felix_position()` opens the first clip frame in the R plot pane. Click
the center of Felix once. The generated poster and both videos use that position
for a mustard circle. The opening frame pauses for 1.25 seconds with
the marker visible, then the marker disappears and the play begins normally.

Allowed categories are `defensive`, `offensive`, `puck-movement`, and
`special-teams`. Use a character vector when the same clip belongs in more than
one filter.

The output directory receives four files:

- `<id>-preview.mp4`: five-second, silent 360p hover preview with the marked pause;
- `<id>.mp4`: marked pause followed by the full timestamp range at up to 720p;
- `<id>.jpg`: marked opening frame shown before playback; and
- `<id>-clip-entry.js`: metadata ready to add to `felix-holtgrieve/clips.js`.

FFmpeg seeks to the clip start before decoding, so it does not reprocess the
whole game. The `veryfast` H.264 preset is intentional for an older Intel Mac.

## Publish it with Cloudflare R2

Post & In uses the existing Cloudflare account with a dedicated Standard-class
R2 bucket named `postandin-media` and the custom domain
`media.postandin.com`. It does not need another Worker or database. R2 Standard
is intentional because its free allowance applies to storage and requests, and
R2 does not charge internet egress. Actual use and billing still need to be
checked in the Cloudflare dashboard.

After processing one clip, publish its three media files from R. Supply an
explicit version every time:

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

Paste the updated generated object inside the `clips` array in
`felix-holtgrieve/clips.js`, preview the page locally, and run:

```sh
node --test tests/felixProfileVisibility.test.mjs
```

Do not put full-game files or generated `.mp4` files in this repository. The
profile test also rejects tracked video files under `felix-holtgrieve/`.
The R2 media bucket is not a backup. Keep the original game files and the clip
timestamps in local storage so a published clip can be recreated if needed.
