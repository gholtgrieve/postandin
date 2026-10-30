# Felix recruiting-card workflow

The repository versions both the public recruiting-card proof and the Python
generator used to create it. The card intentionally contains public parent and
head-coach contact information for recruiting use.

## Requirements

Use Python 3 with `Pillow`, `pypdf`, `qrcode`, and `reportlab` installed. The
generator also requires these font files:

```sh
python3 -m pip install Pillow pypdf qrcode reportlab
```

- `BebasNeue-Regular.ttf`;
- `IBMPlexMono-Regular.ttf`;
- `IBMPlexMono-Medium.ttf`; and
- `IBMPlexMono-Bold.ttf`.

The generator checks the current user's macOS Fonts directory and the shared
macOS Fonts directory. Alternatively, set `FELIX_CARD_FONT_DIR` to a directory
containing all four files.

## Generate and review

From the repository root, run:

```sh
python3 scripts/create-felix-recruiting-card.py
```

The generator writes the two-page PDF to
`output/pdf/felix-holtgrieve-recruiting-card-draft.pdf`. Page one is the front,
and page two is the back. It also assigns the correct 3.5-by-2-inch trim box and
the surrounding 1/8-inch print area.

Render and inspect both pages before committing a revised card:

```sh
mkdir -p tmp/pdfs/review
pdftoppm -png -r 200 \
  output/pdf/felix-holtgrieve-recruiting-card-draft.pdf \
  tmp/pdfs/review/card
```

Files under `tmp/` are generated intermediates and are not versioned.
