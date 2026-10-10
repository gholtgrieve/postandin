# Documentation policy

## Purpose

Documentation is organized by the reader's task rather than by the order in
which features were implemented. Each subject has one canonical owner.

## Status labels

- **Current:** authoritative guidance maintained with the implementation.
- **Historical:** dated evidence or a superseded implementation record.
- **Deprecated:** retained temporarily to direct readers to a replacement.

Files under `docs/archive/` are historical by location and must not be treated as
current instructions unless a current document explicitly incorporates a fact.

## Content rules

1. Keep onboarding concise and link to detail instead of duplicating it.
2. Store stable architecture separately from volatile deployment observations.
3. Mark externally managed state with the date and method of verification.
4. Never document credentials, tokens, private identifiers, or personal data.
5. Put commands that can change external state in an operations document and
   state their prerequisites, scope, verification, and rollback limitations.
6. Distinguish backup creation from tested restoration. Never call a backup
   restorable when no complete restore path exists.
7. Keep historical review notes out of current feature instructions.
8. Use the Oxford comma in Post & In documentation.

## Core products and hosted asides

Ice Time, Coach Profiles, and Gear Exchange are the three core Post & In
products. Seattle Junior Mets 16U AA and Felix profile material are hosted
asides. Aside documentation may refer to shared hosting and deployment, but it
must not present aside pages as Post & In product features or roadmap items.

## Updating documentation

Update the owning document in the same change when behavior, routes, bindings,
cache keys, storage, deployment requirements, or operational commands change.
If a change affects a hosted aside only, update its aside documentation rather
than the core product documentation unless shared platform behavior also changes.

Before handoff, validate local Markdown links, run `git diff --check`, inspect
the rendered Markdown and final diff, and review any commands whose syntax or
target may have changed. Documentation-only work must not introduce a new build
step or dependency solely for validation.
