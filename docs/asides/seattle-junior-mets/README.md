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
roster and season-total information. Updates are manual.

Both URLs are public to anyone who receives the link. `noindex` is not access
control.

## Schedule monitor

The daily GitHub Actions workflow compares NWAHL, SportsEngine, and the reviewed
travel-page schedule. It never edits or deploys the page automatically. See the
[schedule monitor runbook](schedule-monitor.md).

## Repository locations

- `mets-16aa-travel/`
- `mets-16aa-stats/`
- `data/*mets-16aa*` and the associated reviewed hashes/snapshots
- `scripts/check-nwahl-travel.mjs`
- `scripts/team-schedule-monitor.mjs`
- `.github/workflows/check-nwahl-travel.yml`

Changes to these paths normally require aside documentation only. Update shared
platform documentation when routing, deployment, or repository-wide behavior
also changes.
