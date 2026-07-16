#!/usr/bin/env python3
"""Render a branded sermon-content guide PDF from a small JSON payload."""

from __future__ import annotations

import html
import json
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


def color(value: str, fallback: str) -> colors.Color:
    try:
        return colors.HexColor(value)
    except (TypeError, ValueError):
        return colors.HexColor(fallback)


def paragraphs(body: str) -> list[tuple[str, str]]:
    blocks = [block.strip() for block in body.replace("\r", "").split("\n\n") if block.strip()]
    result: list[tuple[str, str]] = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n") if line.strip()]
        for line in lines:
            if line.startswith("### "):
                result.append(("h3", line[4:].strip()))
            elif line.startswith("## "):
                result.append(("h2", line[3:].strip()))
            elif line.startswith("# "):
                result.append(("h2", line[2:].strip()))
            elif line.startswith(("- ", "* ")):
                result.append(("bullet", line[2:].strip()))
            elif len(line) < 90 and (line.lower().startswith("day ") or line.endswith(":")):
                result.append(("h3", line.rstrip(":")))
            else:
                result.append(("body", line))
    return result


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: render-content-guide-pdf.py INPUT_JSON OUTPUT_PDF")

    input_path = Path(sys.argv[1]).resolve()
    output_path = Path(sys.argv[2]).resolve()
    data = json.loads(input_path.read_text(encoding="utf-8"))
    output_path.parent.mkdir(parents=True, exist_ok=True)

    primary = color(data.get("primaryColor"), "#0F766E")
    secondary = color(data.get("secondaryColor"), "#1D4ED8")
    church = str(data.get("churchName") or "Local Church")
    title = str(data.get("title") or "Sermon Guide")
    subtitle = str(data.get("subtitle") or "A sermon-grounded ministry resource")
    scripture = str(data.get("scripture") or "")
    body = str(data.get("bodyContent") or "")

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "GuideTitle",
        parent=styles["Title"],
        fontName="Helvetica-Bold",
        fontSize=28,
        leading=34,
        textColor=colors.white,
        alignment=TA_LEFT,
        spaceAfter=8,
    )
    subtitle_style = ParagraphStyle(
        "GuideSubtitle",
        parent=styles["Normal"],
        fontName="Helvetica",
        fontSize=12,
        leading=17,
        textColor=colors.HexColor("#E5F7F3"),
        alignment=TA_LEFT,
    )
    h2 = ParagraphStyle(
        "H2",
        parent=styles["Heading2"],
        fontName="Helvetica-Bold",
        fontSize=17,
        leading=22,
        textColor=primary,
        spaceBefore=8,
        spaceAfter=7,
        keepWithNext=True,
    )
    h3 = ParagraphStyle(
        "H3",
        parent=styles["Heading3"],
        fontName="Helvetica-Bold",
        fontSize=13,
        leading=18,
        textColor=secondary,
        spaceBefore=8,
        spaceAfter=5,
        keepWithNext=True,
    )
    body_style = ParagraphStyle(
        "Body",
        parent=styles["BodyText"],
        fontName="Helvetica",
        fontSize=10.5,
        leading=16,
        textColor=colors.HexColor("#263238"),
        spaceAfter=7,
    )
    bullet_style = ParagraphStyle(
        "Bullet",
        parent=body_style,
        leftIndent=14,
        firstLineIndent=-8,
        bulletIndent=2,
        spaceAfter=5,
    )
    scripture_style = ParagraphStyle(
        "Scripture",
        parent=body_style,
        fontName="Helvetica-Oblique",
        textColor=primary,
        borderColor=colors.HexColor("#CFE8E2"),
        borderWidth=1,
        borderPadding=9,
        backColor=colors.HexColor("#F1FAF8"),
        spaceAfter=14,
    )

    def page_frame(canvas, doc):
        width, height = A4
        canvas.saveState()
        canvas.setFillColor(primary)
        canvas.rect(0, height - 16 * mm, width, 16 * mm, stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.setFont("Helvetica-Bold", 9)
        canvas.drawString(18 * mm, height - 10.5 * mm, church[:70])
        canvas.setStrokeColor(colors.HexColor("#DDE5E7"))
        canvas.line(18 * mm, 14 * mm, width - 18 * mm, 14 * mm)
        canvas.setFillColor(colors.HexColor("#607D8B"))
        canvas.setFont("Helvetica", 8)
        canvas.drawString(18 * mm, 9 * mm, "Sermon Clip ministry resource")
        canvas.drawRightString(width - 18 * mm, 9 * mm, f"Page {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        str(output_path),
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=25 * mm,
        bottomMargin=20 * mm,
        title=title,
        author=church,
        subject="Sermon-grounded ministry guide",
    )

    story = []
    # A compact brand-colour cover band, kept inside the page frame.
    cover_table = [
        Paragraph(html.escape(title), title_style),
        Spacer(1, 3 * mm),
        Paragraph(html.escape(subtitle), subtitle_style),
    ]
    cover = Table([[cover_table]], colWidths=[A4[0] - 36 * mm])
    cover.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), primary),
        ("BOX", (0, 0), (-1, -1), 0, primary),
        ("LEFTPADDING", (0, 0), (-1, -1), 14 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 8 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8 * mm),
    ]))
    story.extend([cover, Spacer(1, 4 * mm)])
    if scripture:
        story.append(Paragraph(f"<b>Main Scripture:</b> {html.escape(scripture)}", scripture_style))

    for kind, text in paragraphs(body):
        safe = html.escape(text)
        if kind == "h2":
            story.append(Paragraph(safe, h2))
        elif kind == "h3":
            story.append(Paragraph(safe, h3))
        elif kind == "bullet":
            story.append(Paragraph(f"&#8226;&nbsp; {safe}", bullet_style))
        else:
            story.append(Paragraph(safe, body_style))

    if not body.strip():
        story.append(Paragraph("No approved guide content was provided.", body_style))

    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)


if __name__ == "__main__":
    main()
