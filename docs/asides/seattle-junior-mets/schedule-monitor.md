# Seattle Junior Mets schedule monitor

Status: **current hosted-aside runbook**.

The monitor covers every NWAHL and SportsEngine game involving the team and
compares travel-relevant games with `/mets-16aa-travel/`. It ignores SportsEngine
practices and other non-game events. Tournament sites outside those sources are
not monitored.

## State

Reviewed repository baselines under `data/` bootstrap the first run. Normal
scheduled runs store validated state in the closed, bot-authored GitHub issue
`[automation] Team schedule monitor state`. The workflow refuses an existing
state issue with a malformed marker rather than silently falling back.

Only `github-actions[bot]` state is trusted. State advances only after required
notifications and issue updates succeed.

## Notification routing

- An NWAHL change that creates a new disagreement with SportsEngine can notify
  the group when attribution is clear.
- A SportsEngine-only change never notifies the group. It notifies the owner
  only when it creates a disagreement with the travel page; otherwise it sends
  no email.
- Ambiguous changes, travel-page mismatches, and checker failures notify the
  owner only.
- Every actionable alert is also recorded in the GitHub issue
  `Team schedule needs review`.
- A recorded unresolved discrepancy does not generate daily repeat email.
- A resolution by itself does not generate email.
- Failures do not advance state.

Before rerunning a failed job, determine whether email succeeded but state saving
failed; rerunning that case can send a duplicate.

## Secrets

Recipients and SMTP credentials exist only as GitHub Actions secrets. Never add
addresses or credentials to repository files, logs, documentation, or prompts.
If email configuration is absent, GitHub issues remain the fallback alert.

## Local check

```bash
node scripts/team-schedule-monitor.mjs
```

Without `TEAM_MONITOR_STATE_PATH`, the script compares live sources with the
reviewed repository baselines. Tests must use fixtures and temporary state paths.

GitHub may disable scheduled workflows after prolonged repository inactivity. If
that occurs, manually re-enable the workflow and verify a matching run.

Exact comparison rules, exceptions, workflow schedule, and secret names are
authoritative in the script and workflow files.
