from pathlib import Path
import sys

from reportlab.lib.colors import HexColor
from reportlab.graphics import renderSVG
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing, Rect


RSVP_URL = "https://melusi.app/connect/believe-belong-become/events/dfrzcpInFr-bdfW4wReH-dL0pBMefA4n/rsvp"
MODULE_SCALE = 12
QUIET_ZONE_MODULES = 4


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate-conference-rsvp-qr.py <output.svg>")

    output_path = Path(sys.argv[1])
    output_path.parent.mkdir(parents=True, exist_ok=True)

    qr = QrCodeWidget(
        RSVP_URL,
        barLevel="H",
        barBorder=QUIET_ZONE_MODULES,
    )
    qr.qr.make()
    matrix_modules = len(qr.qr.modules)
    total_modules = matrix_modules + QUIET_ZONE_MODULES * 2
    output_size = total_modules * MODULE_SCALE
    qr.barWidth = output_size
    qr.barHeight = output_size

    drawing = Drawing(output_size, output_size)
    drawing.add(
        Rect(
            0,
            0,
            output_size,
            output_size,
            fillColor=HexColor("#FFFFFF"),
            strokeColor=None,
        )
    )
    drawing.add(qr)
    renderSVG.drawToFile(drawing, str(output_path))

    print(
        {
            "matrix_modules": matrix_modules,
            "quiet_zone_modules": QUIET_ZONE_MODULES,
            "module_scale": MODULE_SCALE,
            "output_size": output_size,
            "output": str(output_path),
        }
    )


if __name__ == "__main__":
    main()
