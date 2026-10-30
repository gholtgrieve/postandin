from pathlib import Path
import os

import qrcode
from PIL import Image
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "felix-holtgrieve-recruiting-card-draft.pdf"
RAW_OUTPUT = ROOT / "tmp" / "pdfs" / "felix-holtgrieve-recruiting-card-raw.pdf"
HEADSHOT = ROOT / "felix-holtgrieve" / "images" / "felix-headshot.webp"
QR_PATH = ROOT / "tmp" / "pdfs" / "felix-profile-qr.png"

PAGE_W = 3.5 * 72
PAGE_H = 2 * 72
BLEED = 0.125 * 72
CANVAS_W = PAGE_W + 2 * BLEED
CANVAS_H = PAGE_H + 2 * BLEED
PROFILE_URL = "https://postandin.com/felix-holtgrieve/"

PAPER = HexColor("#E8E3D8")
WHITE = HexColor("#FFFFFF")
PANEL = HexColor("#EFEBE2")
RULE = HexColor("#B8B2A4")
INK = HexColor("#2E2A26")
INK_2 = HexColor("#3D3A34")
INK_3 = HexColor("#6E6A61")
MUSTARD = HexColor("#9A7B00")
MUSTARD_2 = HexColor("#7C6300")


def find_font(filename):
    candidates = []
    if font_dir := os.environ.get("FELIX_CARD_FONT_DIR"):
        candidates.append(Path(font_dir) / filename)
    candidates.extend(
        [
            Path.home() / "Library" / "Fonts" / filename,
            Path("/Library/Fonts") / filename,
            Path("/private/tmp/felix-card-fonts") / filename,
        ]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Could not find {filename}. Install it in a macOS Fonts directory or set "
        "FELIX_CARD_FONT_DIR to a directory containing the required font files."
    )


def register_fonts():
    pdfmetrics.registerFont(TTFont("BebasNeue", str(find_font("BebasNeue-Regular.ttf"))))
    pdfmetrics.registerFont(
        TTFont("IBMPlexMono", str(find_font("IBMPlexMono-Regular.ttf")))
    )
    pdfmetrics.registerFont(
        TTFont("IBMPlexMono-Medium", str(find_font("IBMPlexMono-Medium.ttf")))
    )
    pdfmetrics.registerFont(
        TTFont("IBMPlexMono-Bold", str(find_font("IBMPlexMono-Bold.ttf")))
    )


def make_qr():
    qr = qrcode.QRCode(
        version=None,
        error_correction=qrcode.constants.ERROR_CORRECT_Q,
        box_size=16,
        border=4,
    )
    qr.add_data(PROFILE_URL)
    qr.make(fit=True)
    image = qr.make_image(fill_color="#2E2A26", back_color="#EFEBE2").convert("RGB")
    image.save(QR_PATH, quality=100)


def draw_crop_fill(c, image_path, x, y, width, height, focus_x=0.5, focus_y=0.5):
    image = Image.open(image_path).convert("RGB")
    source_ratio = image.width / image.height
    target_ratio = width / height
    if source_ratio > target_ratio:
        crop_width = int(image.height * target_ratio)
        left = int((image.width - crop_width) * focus_x)
        left = max(0, min(left, image.width - crop_width))
        crop = image.crop((left, 0, left + crop_width, image.height))
    else:
        crop_height = int(image.width / target_ratio)
        top = int((image.height - crop_height) * focus_y)
        top = max(0, min(top, image.height - crop_height))
        crop = image.crop((0, top, image.width, top + crop_height))
    c.drawImage(ImageReader(crop), x, y, width=width, height=height, mask="auto")


def tracking_text(c, text, x, y, font, size, color, tracking=0.8):
    c.setFillColor(color)
    c.setFont(font, size)
    cursor = x
    for character in text:
        c.drawString(cursor, y, character)
        cursor += pdfmetrics.stringWidth(character, font, size) + tracking


def draw_front(c):
    # Keep the extra 1/8-inch print area white so the trim edge is visible.
    c.setFillColor(WHITE)
    c.rect(0, 0, CANVAS_W, CANVAS_H, fill=1, stroke=0)

    c.saveState()
    c.translate(BLEED, BLEED)

    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    photo_w = 104
    draw_crop_fill(c, HEADSHOT, 0, 0, photo_w, PAGE_H, focus_x=0.5, focus_y=0.26)

    c.setFillColor(MUSTARD)
    c.rect(photo_w, 0, 4, PAGE_H, fill=1, stroke=0)

    x = 121
    tracking_text(c, "SEATTLE JUNIOR METS 16U AA", x, 119, "IBMPlexMono-Bold", 5.1, MUSTARD_2, tracking=0.35)
    c.setFillColor(INK)
    c.setFont("BebasNeue", 31)
    c.drawString(x, 84, "FELIX")
    c.drawString(x, 55, "HOLTGRIEVE")

    c.setStrokeColor(RULE)
    c.setLineWidth(0.7)
    c.line(x, 44, PAGE_W - 12, 44)

    c.setFillColor(INK_2)
    c.setFont("IBMPlexMono-Bold", 5.8)
    c.drawString(x, 31, "NO. 17  |  DEFENSE  |  RIGHT SHOT")
    c.setFillColor(INK_2)
    c.setFont("IBMPlexMono-Bold", 5.4)
    c.drawString(x, 17, "6'0\"  |  173 LB  |  BORN 2011")

    c.setFillColor(INK)
    c.rect(PAGE_W - 27, PAGE_H - 25, 15, 13, fill=1, stroke=0)
    c.setFillColor(PAPER)
    c.setFont("BebasNeue", 10)
    c.drawCentredString(PAGE_W - 19.5, PAGE_H - 22.1, "P&I")

    c.restoreState()
    c.showPage()


def draw_back(c):
    c.setFillColor(WHITE)
    c.rect(0, 0, CANVAS_W, CANVAS_H, fill=1, stroke=0)

    c.saveState()
    c.translate(BLEED, BLEED)

    c.setFillColor(INK)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(MUSTARD)
    c.rect(0, PAGE_H - 4, PAGE_W, 4, fill=1, stroke=0)

    x = 15
    c.setFillColor(PAPER)
    c.setFont("BebasNeue", 21)
    c.drawString(x, 109, "FELIX HOLTGRIEVE")
    c.setFillColor(RULE)
    c.setFont("IBMPlexMono", 5.0)
    c.drawString(24, 91, "Puck-moving defenseman averaging")
    c.drawString(24, 84, "0.5 points per game.")
    c.drawString(24, 76, "Two-year PNAHA State Development")
    c.drawString(24, 69, "Camp participant.")
    c.drawString(24, 61, "Currently earning a 3.4 GPA while taking AP")
    c.drawString(24, 54, "World History, advanced math, and French 2.")
    c.drawString(24, 47, "Plans to balance strong academics with hockey after high school.")
    c.setFillColor(MUSTARD)
    for bullet_y in (91, 76, 61, 47):
        c.circle(16.5, bullet_y + 2.1, 1.5, fill=1, stroke=0)

    qr_size = 58
    qr_x = PAGE_W - qr_size - 13
    qr_y = 73
    c.setFillColor(PANEL)
    c.roundRect(qr_x - 4, qr_y - 4, qr_size + 8, qr_size + 8, 3, fill=1, stroke=0)
    c.drawImage(str(QR_PATH), qr_x, qr_y, width=qr_size, height=qr_size, mask="auto")
    c.setFillColor(PAPER)
    c.setFont("IBMPlexMono-Bold", 4.6)
    c.drawCentredString(qr_x + qr_size / 2, 62, "SCAN FOR PROFILE & VIDEO")

    c.setStrokeColor(HexColor("#514D47"))
    c.setLineWidth(0.7)
    c.line(15, 41, PAGE_W - 15, 41)
    c.line(PAGE_W / 2, 11.5, PAGE_W / 2, 36)

    tracking_text(c, "PARENT CONTACT", 15, 34, "IBMPlexMono-Bold", 5.0, MUSTARD, tracking=0.48)
    c.setFillColor(PAPER)
    c.setFont("IBMPlexMono-Medium", 5.4)
    c.drawString(15, 25.5, "GORDON HOLTGRIEVE")
    c.setFillColor(RULE)
    c.setFont("IBMPlexMono", 4.5)
    c.drawString(15, 17.8, "gholtgrieve@gmail.com")
    c.drawString(15, 11.5, "(206) 227-9930")

    tracking_text(c, "HEAD COACH", PAGE_W / 2 + 8, 34, "IBMPlexMono-Bold", 5.0, MUSTARD, tracking=0.48)
    c.setFillColor(PAPER)
    c.setFont("IBMPlexMono-Medium", 5.4)
    c.drawString(PAGE_W / 2 + 8, 25.5, "KYLE MOORE")
    c.setFillColor(RULE)
    c.setFont("IBMPlexMono", 4.5)
    c.drawString(PAGE_W / 2 + 8, 17.8, "coachkyle2244@gmail.com")
    c.drawString(PAGE_W / 2 + 8, 11.5, "(206) 372-6791")

    c.restoreState()
    c.showPage()


def apply_print_boxes():
    reader = PdfReader(str(RAW_OUTPUT))
    writer = PdfWriter()
    for page in reader.pages:
        page.trimbox.lower_left = (BLEED, BLEED)
        page.trimbox.upper_right = (BLEED + PAGE_W, BLEED + PAGE_H)
        page.bleedbox.lower_left = (0, 0)
        page.bleedbox.upper_right = (CANVAS_W, CANVAS_H)
        writer.add_page(page)
    if reader.metadata:
        writer.add_metadata(dict(reader.metadata))
    with OUTPUT.open("wb") as stream:
        writer.write(stream)
    RAW_OUTPUT.unlink()


def main():
    register_fonts()
    QR_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    make_qr()
    c = canvas.Canvas(str(RAW_OUTPUT), pagesize=(CANVAS_W, CANVAS_H))
    c.setTitle("Felix Holtgrieve Recruiting Card - Draft")
    c.setAuthor("Post & In")
    c.setSubject("Two-sided player recruiting card")
    draw_front(c)
    draw_back(c)
    c.save()
    apply_print_boxes()
    print(OUTPUT)


if __name__ == "__main__":
    main()
