# Felix recruiting-card workflow

The repository versions both the public recruiting-card proof and the Python
generator used to create it. The card intentionally contains public parent and
head-coach contact information for recruiting use.

## Requirements

Use Python 3 and install the versions used to generate the committed proof:

```sh
python3 -m pip install \
  Pillow==12.3.0 \
  pypdf==6.10.0 \
  qrcode==8.2 \
  reportlab==4.4.9
```

Install Poppler for the visual-review command:

```sh
brew install poppler
```

The generator also requires these font files, available from Google Fonts:

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
and page two is the back. It assigns a 3.5-by-2-inch trim box, extends edge
artwork through the surrounding 1/8-inch bleed, and writes deterministic PDF
metadata so an unchanged regeneration is byte-for-byte stable.

Render and inspect both pages before committing a revised card:

```sh
mkdir -p tmp/pdfs/review
pdftoppm -png -r 200 \
  output/pdf/felix-holtgrieve-recruiting-card-draft.pdf \
  tmp/pdfs/review/card
```

Files under `tmp/` are generated intermediates and are not versioned.
