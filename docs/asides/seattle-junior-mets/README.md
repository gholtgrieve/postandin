# Seattle Junior Mets 16U AA

Status: **hosted aside; not a Post & In product**.

These pages and automation use the Post & In repository and Pages deployment for
convenience. They are not part of the Ice Time, Coach Profiles, or Gear Exchange
product architecture or roadmap.

## Pages

### Travel logistics

`/mets-16aa-travel/` is mobile-first, direct-link, unlisted, omitted from the
sitemap, and protected from indexing through page metadata and `_headers`. It
contains no player-specific or private family data.

Published game times must retain the reminder that players need to be ready for
pre-game warmups one hour earlier and that families should plan to arrive about
1 hour 15 minutes early. The visibility tests enforce the relationship between
published times and reminders.

### Season statistics

`/mets-16aa-stats/` is a direct-link, unlisted, `noindex` page using public team
roster and season-total information. Its player table defaults to confirmed
video-reviewed scoring attributions and can be switched to the official
scoresheet/NWAHL totals. The page reports team expected penalty cost from the
reviewed private database. Equal-share goal credit, player expected penalty
cost, realized PK goals against, and scoring net remain calculated in the
database for analysis and retrieval, but are not displayed in the public player
table. Updates are manual. The page uses a dedicated, season-wide social preview
image that does not require regeneration after each game.

Future agents must follow the canonical [data and statistics
runbook](data-and-stats-runbook.md) when adding games, reconciling sources,
recording video reviews, or refreshing the page.

### Reviewed goal videos

`/mets-16aa-goals/` is a public, direct-link, unlisted, `noindex` video library.
It groups human-reviewed Seattle Junior goal clips by game in reverse
chronological order. Eligible games link to their section from the Season
Results timeline on the statistics page. A goal appears only after a human has
confirmed exact clip boundaries; an attribution timestamp alone is not enough
to publish a clip.

The raw game recordings remain private. Public excerpts and poster images use
versioned paths under `https://media.postandin.com/mets/2026-27/`. The private
database is the source of truth for clip status and object keys.

All three URLs are public to anyone who receives the link. `noindex` is not
access control.

## Schedule monitor

The daily GitHub Actions workflow compares NWAHL, SportsEngine, and the reviewed
travel-page schedule. It never edits or deploys the page automatically. See the
[schedule monitor runbook](schedule-monitor.md).

## Repository locations

- `mets-16aa-travel/`
- `mets-16aa-stats/`
- `mets-16aa-goals/`
- `data/*mets-16aa*` and the associated reviewed hashes/snapshots
- `scripts/process-mets-goal-clips.R`
- `scripts/check-nwahl-travel.mjs`
- `scripts/team-schedule-monitor.mjs`
- `.github/workflows/check-nwahl-travel.yml`

Changes to these paths normally require aside documentation only. Update shared
platform documentation when routing, deployment, or repository-wide behavior
also changes.
