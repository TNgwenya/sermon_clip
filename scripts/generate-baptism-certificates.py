from pathlib import Path

from PIL import Image
from reportlab.lib.colors import Color, HexColor
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


PROJECT_ROOT = Path("/Users/thabangngwenya/Development/Projects/sermon_clip")
OUTPUT_DIR = PROJECT_ROOT / "output" / "pdf"
TMP_DIR = PROJECT_ROOT / "tmp" / "pdfs"
OUTPUT_PDF = (
    OUTPUT_DIR / "renewed-life-international-baptism-certificates-refined.pdf"
)
LOGO_SOURCE = (
    PROJECT_ROOT
    / "public"
    / "uploads"
    / "branding"
    / "church-logo-1782927847716.png"
)
LOGO_MARK = TMP_DIR / "renewed-life-logo-mark.png"

RECIPIENTS = [
    "Dumisani Mdluli",
    "Sinenhlanhla Mkhwanazi",
    "Thembekile Trusted Nyandeni",
    "Siphesihle Nokuthula Mdini",
    "Phumelele Angel Mbuthu",
]

NAVY = HexColor("#06172B")
BLUE = HexColor("#0C67A6")
CYAN = HexColor("#6DC8DE")
GREEN = HexColor("#78B84C")
GOLD = HexColor("#C9A34A")
IVORY = HexColor("#FFFDF7")
INK_GREY = HexColor("#4B5964")
PALE_BLUE = HexColor("#EAF5FA")
PALE_GREEN = HexColor("#F0F7EA")


def register_fonts():
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("Georgia", str(font_dir / "Georgia.ttf")))
    pdfmetrics.registerFont(TTFont("Georgia-Bold", str(font_dir / "Georgia Bold.ttf")))
    pdfmetrics.registerFont(TTFont("Georgia-Italic", str(font_dir / "Georgia Italic.ttf")))
    pdfmetrics.registerFont(
        TTFont("Georgia-BoldItalic", str(font_dir / "Georgia Bold Italic.ttf"))
    )


def prepare_logo_mark():
    source = Image.open(LOGO_SOURCE).convert("RGBA")
    mark_region = source.crop((560, 110, 1440, 960))
    alpha_bbox = mark_region.getchannel("A").getbbox()
    if alpha_bbox:
        mark_region = mark_region.crop(alpha_bbox)
    mark_region.thumbnail((900, 900), Image.Resampling.LANCZOS)
    mark_region.save(LOGO_MARK)


def draw_centered_spaced_text(
    c: canvas.Canvas,
    text: str,
    center_x: float,
    y: float,
    font_name: str,
    font_size: float,
    color,
    char_space: float,
):
    width = pdfmetrics.stringWidth(text, font_name, font_size)
    width += char_space * max(0, len(text) - 1)
    text_object = c.beginText()
    text_object.setTextOrigin(center_x - width / 2, y)
    text_object.setFont(font_name, font_size)
    text_object.setFillColor(color)
    text_object.setCharSpace(char_space)
    text_object.textOut(text)
    text_object.setCharSpace(0)
    c.drawText(text_object)


def draw_wave(c: canvas.Canvas, y: float, color, alpha: float, offset: float):
    c.saveState()
    c.setStrokeColor(color)
    c.setStrokeAlpha(alpha)
    c.setLineWidth(1.4)
    path = c.beginPath()
    path.moveTo(42, y)
    path.curveTo(150, y + 20 + offset, 250, y - 18, 360, y + 4)
    path.curveTo(480, y + 28, 590, y - 16 - offset, 800, y + 7)
    c.drawPath(path, stroke=1, fill=0)
    c.restoreState()


def draw_corner_detail(c: canvas.Canvas, x: float, y: float, sx: int, sy: int):
    c.saveState()
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.2)
    c.line(x, y, x + 34 * sx, y)
    c.line(x, y, x, y + 34 * sy)
    c.setStrokeColor(BLUE)
    c.setLineWidth(2.6)
    c.line(x + 7 * sx, y + 7 * sy, x + 27 * sx, y + 7 * sy)
    c.line(x + 7 * sx, y + 7 * sy, x + 7 * sx, y + 27 * sy)
    c.restoreState()


def fit_name_font(name: str, max_width: float) -> float:
    font_size = 35.0
    while font_size > 25:
        if pdfmetrics.stringWidth(name, "Georgia-BoldItalic", font_size) <= max_width:
            return font_size
        font_size -= 0.5
    return font_size


def draw_signature_block(
    c: canvas.Canvas,
    center_x: float,
    line_width: float,
    primary_label: str,
    secondary_label: str = "",
    y_line: float = 132,
):
    c.setStrokeColor(Color(0.06, 0.18, 0.27, alpha=0.55))
    c.setLineWidth(0.8)
    c.line(center_x - line_width / 2, y_line, center_x + line_width / 2, y_line)
    draw_centered_spaced_text(
        c,
        primary_label,
        center_x,
        y_line - 18,
        "Helvetica-Bold",
        8.3,
        NAVY,
        0.8,
    )
    if secondary_label:
        draw_centered_spaced_text(
            c,
            secondary_label,
            center_x,
            y_line - 31,
            "Helvetica",
            7.2,
            INK_GREY,
            1.0,
        )


def draw_certificate_page(c: canvas.Canvas, recipient: str):
    page_width, page_height = landscape(A4)

    c.setFillColor(IVORY)
    c.rect(0, 0, page_width, page_height, stroke=0, fill=1)

    c.saveState()
    c.setFillAlpha(0.52)
    c.setFillColor(PALE_BLUE)
    c.circle(62, page_height - 65, 160, stroke=0, fill=1)
    c.setFillAlpha(0.38)
    c.setFillColor(PALE_GREEN)
    c.circle(page_width - 24, 44, 185, stroke=0, fill=1)
    c.restoreState()

    c.saveState()
    c.setFillColor(HexColor("#F7FAFB"))
    cross_x = page_width - 96
    c.roundRect(cross_x - 7, 238, 14, 122, 5, stroke=0, fill=1)
    c.roundRect(cross_x - 39, 310, 78, 14, 5, stroke=0, fill=1)
    c.restoreState()

    draw_wave(c, 61, BLUE, 0.24, 0)
    draw_wave(c, 72, GREEN, 0.20, 5)
    draw_wave(c, 83, GOLD, 0.16, -4)

    c.setStrokeColor(NAVY)
    c.setLineWidth(2.2)
    c.roundRect(18, 18, page_width - 36, page_height - 36, 10, stroke=1, fill=0)
    c.setStrokeColor(GOLD)
    c.setLineWidth(0.8)
    c.roundRect(24, 24, page_width - 48, page_height - 48, 8, stroke=1, fill=0)
    c.setStrokeColor(Color(0.05, 0.38, 0.63, alpha=0.55))
    c.setLineWidth(0.6)
    c.roundRect(29, 29, page_width - 58, page_height - 58, 7, stroke=1, fill=0)

    draw_corner_detail(c, 38, 38, 1, 1)
    draw_corner_detail(c, page_width - 38, 38, -1, 1)
    draw_corner_detail(c, 38, page_height - 38, 1, -1)
    draw_corner_detail(c, page_width - 38, page_height - 38, -1, -1)

    logo_size = 54
    c.drawImage(
        str(LOGO_MARK),
        page_width / 2 - logo_size / 2,
        page_height - 83,
        width=logo_size,
        height=logo_size,
        preserveAspectRatio=True,
        anchor="c",
        mask="auto",
    )

    draw_centered_spaced_text(
        c,
        "RENEWED LIFE INTERNATIONAL",
        page_width / 2,
        page_height - 96,
        "Helvetica-Bold",
        10.2,
        NAVY,
        1.9,
    )
    draw_centered_spaced_text(
        c,
        "BELIEVE  |  BELONG  |  BECOME",
        page_width / 2,
        page_height - 113,
        "Helvetica-Bold",
        6.8,
        BLUE,
        1.2,
    )

    c.setStrokeColor(GOLD)
    c.setLineWidth(0.9)
    c.line(page_width / 2 - 150, page_height - 126, page_width / 2 + 150, page_height - 126)

    c.setFillColor(NAVY)
    c.setFont("Georgia-Bold", 34)
    c.drawCentredString(page_width / 2, page_height - 171, "CERTIFICATE")

    draw_centered_spaced_text(
        c,
        "OF WATER BAPTISM",
        page_width / 2,
        page_height - 195,
        "Helvetica-Bold",
        12,
        GREEN,
        3.3,
    )

    c.setFillColor(INK_GREY)
    c.setFont("Georgia-Italic", 12.5)
    c.drawCentredString(page_width / 2, page_height - 233, "This is to certify that")

    name_font_size = fit_name_font(recipient, 650)
    c.setFillColor(BLUE)
    c.setFont("Georgia-BoldItalic", name_font_size)
    c.drawCentredString(page_width / 2, page_height - 282, recipient)

    name_width = min(
        650,
        pdfmetrics.stringWidth(recipient, "Georgia-BoldItalic", name_font_size) + 54,
    )
    c.setStrokeColor(GOLD)
    c.setLineWidth(1.2)
    c.line(
        page_width / 2 - name_width / 2,
        page_height - 294,
        page_width / 2 + name_width / 2,
        page_height - 294,
    )

    c.setFillColor(INK_GREY)
    c.setFont("Georgia", 10.5)
    c.drawCentredString(
        page_width / 2,
        page_height - 326,
        "having publicly confessed faith in Jesus Christ, was baptised in water",
    )
    c.drawCentredString(
        page_width / 2,
        page_height - 345,
        "as a testimony of faith, obedience and new life in Christ.",
    )

    c.setFillColor(BLUE)
    c.setFont("Georgia-Italic", 10.5)
    c.drawCentredString(
        page_width / 2,
        page_height - 382,
        "Raised to walk in newness of life. - Romans 6:4",
    )

    draw_signature_block(c, 222, 230, "DATE OF BAPTISM")
    draw_signature_block(
        c,
        page_width - 222,
        230,
        "PST T NGWENYA",
        "OFFICIATING PASTOR",
    )

    c.showPage()


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)
    register_fonts()
    prepare_logo_mark()

    c = canvas.Canvas(str(OUTPUT_PDF), pagesize=landscape(A4), pageCompression=1)
    c.setTitle("Renewed Life International - Baptism Certificates")
    c.setAuthor("Renewed Life International")
    c.setSubject("Certificates of Water Baptism")
    for recipient in RECIPIENTS:
        draw_certificate_page(c, recipient)
    c.save()
    print(OUTPUT_PDF)


if __name__ == "__main__":
    main()
