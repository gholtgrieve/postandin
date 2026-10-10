# Post & In

Post & In is a Seattle-area hockey resource centered on three public products:

- **[Ice Time](https://postandin.com/stick-and-puck/)** — aggregated Stick &
  Puck, Drop-in Hockey, and Public Skate schedules.
- **[Coach Profiles](https://postandin.com/coaches/)** — a searchable directory
  of local coaches and server-rendered profile pages.
- **[Gear Exchange](https://postandin.com/gear/)** — a local, adult-only
  classifieds service for hockey gear.

The repository also hosts Seattle Junior Mets 16U AA pages and a player profile
for operational convenience. Those pages are **hosted asides**, not Post & In
products, and are kept separate from the core product architecture and roadmap.
See [Hosted asides](docs/asides/README.md).

## Documentation

Start with the [documentation index](docs/README.md). It identifies the
canonical document for each subject and separates current guidance from
historical evidence.

| Need | Start here |
|---|---|
| Understand the system | [Platform architecture](docs/platform/architecture.md) |
| Work on Ice Time | [Ice Time](docs/core/ice-time.md) |
| Work on Coach Profiles | [Coach Profiles](docs/core/coaches.md) |
| Work on Gear Exchange | [Gear Exchange](docs/core/gear-exchange/README.md) |
| Develop and test locally | [Development and testing](docs/platform/development-and-testing.md) |
| Understand deployments | [Deployment topology](docs/platform/deployment.md) |
| Operate schedules or Groups | [Ice Time and Groups operations](docs/operations/ice-time-and-groups.md) |
| Review implementation rules | [AGENTS.md](AGENTS.md) |
| Perform an independent review | [CLAUDE.md](CLAUDE.md) |

Code and checked-in configuration are authoritative. Documentation about
externally managed services records the last verified state, not a guarantee of
current provider configuration.

## Architecture at a glance

The site deliberately uses vanilla HTML, CSS, and JavaScript. Cloudflare Pages
serves the static site and Pages Functions. Four independently deployed Workers
support Groups, schedule collection and backup, Gear maintenance, and Gear image
processing.

```text
Cloudflare Pages
├── static product pages
├── Pages Functions
└── shared modules in lib/

Independent Workers
├── group-do/          Groups membership and RSVPs
├── scheduler/         Ice Time scraping and Groups backups
├── gear-maintenance/  Gear cleanup and reconciliation
└── gear-images/       Private Gear image processing
```

Pushing `main` deploys Pages, but it does not deploy any of the four Workers.
See the [deployment matrix](docs/platform/deployment.md) before releasing a
change.

## Local development

Static pages:

```bash
python3 -m http.server
```

Pages Functions and bindings:

```bash
npx wrangler pages dev .
```

The Pages compatibility date is managed outside this repository. Verify it in
Cloudflare and pass it explicitly when runtime parity matters.

## Verification

Choose checks based on the files changed. The common repository checks are:

```bash
node --test tests/*.test.mjs
node scripts/audit-rinks.js
node scripts/health-check.js
git diff --check
```

The two scripts contact live public sources and are read-only. JavaScript edits
also require `node --check` where Node can parse the file. Frontend work requires
mobile and desktop browser checks plus console inspection. Detailed expectations
are in [Development and testing](docs/platform/development-and-testing.md).

## Contribution boundaries

- Work on a short-lived `codex/<task>` branch.
- Do not commit, push, merge, deploy, change production data, or use live secrets
  without explicit owner approval.
- Do not add a framework, build system, package manager, or dependency without
  explicit approval.
- Keep credentials, provider identifiers, and private personal information out
  of this public repository.
- Preserve the documented deployment boundary between Pages and the independent
  Workers.

The complete working agreement is in [AGENTS.md](AGENTS.md).
