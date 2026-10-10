# Design system

For writing principles and approved language, see
[Editorial voice](editorial-voice.md).

Status: **current shared visual contract**.

## Typography

- Bebas Neue for display text.
- IBM Plex Mono for body and interface text.
- Load the same families and weights already used by the site.
- Do not substitute system fonts or lookalikes without owner approval.

## Shared shell

User-facing pages use:

- a 52px dark navigation bar;
- a warm paper background;
- centered content no wider than 1100px;
- mustard page rules;
- the standard dark footer.

Feature controls can differ, but they must not redefine the shared chrome,
palette, typography, or content width.

## Implementation

The project uses vanilla HTML, CSS, and JavaScript. Do not add a framework, CSS
framework, bundler, build step, package manager, or dependency without explicit
approval.

Keep changes narrowly scoped. A feature change is not authorization for an
opportunistic redesign or shared-shell refactor.

## Accessibility and responsive checks

Frontend changes require:

- keyboard operation and visible focus;
- meaningful labels and grouping;
- readable contrast and type size;
- mobile and desktop layout checks;
- empty, loading, success, and failure states as applicable;
- browser-console inspection.

Product-specific UX and copy decisions remain with the owner.
