import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = "/Users/thabangngwenya/Development/Projects/sermon_clip";
const sourcePoster =
  "/Users/thabangngwenya/Downloads/WhatsApp Image 2026-07-10 at 10.20.17 (1).jpeg";
const outputDir = path.join(
  projectRoot,
  "design",
  "conference-crowned-rsvp",
);
const qrSvgPath = path.join(outputDir, "conference-rsvp-qr.svg");
const standaloneQrPath = path.join(outputDir, "conference-rsvp-qr.png");
const posterPngPath = path.join(
  outputDir,
  "crowned-conference-rsvp-qr-poster.png",
);
const posterJpgPath = path.join(
  outputDir,
  "crowned-conference-rsvp-qr-poster.jpg",
);

await fs.mkdir(outputDir, { recursive: true });

const qrMetadata = await sharp(qrSvgPath).metadata();
if (!qrMetadata.width || qrMetadata.width % 3 !== 0) {
  throw new Error(`Unexpected QR width: ${qrMetadata.width}`);
}

const standaloneQrSize = qrMetadata.width;

const standaloneQr = await sharp(qrSvgPath)
  .resize({ width: standaloneQrSize, height: standaloneQrSize })
  .flatten({ background: "#FFFFFF" })
  .png({ compressionLevel: 9 })
  .toBuffer();
await fs.writeFile(standaloneQrPath, standaloneQr);

const posterQrSize = standaloneQrSize / 3;
const posterQr = await sharp(standaloneQr)
  .resize({
    width: posterQrSize,
    height: posterQrSize,
    kernel: sharp.kernel.nearest,
    fit: "fill",
  })
  .png()
  .toBuffer();

const poster = sharp(sourcePoster).rotate();
const posterMetadata = await poster.metadata();
const width = posterMetadata.width;
const height = posterMetadata.height;
if (width !== 1024 || height !== 1536) {
  throw new Error(`Unexpected poster dimensions: ${width}x${height}`);
}

const cardWidth = posterQrSize + 30;
const cardHeight = posterQrSize + 76;
const cardX = width - cardWidth - 18;
const cardY = 18;
const qrX = cardX + 15;
const qrY = cardY + 61;
const gold = "#E8C76B";
const purple = "#190923";

const cardSvg = Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <filter id="cardShadow" x="-30%" y="-30%" width="180%" height="190%">
        <feDropShadow dx="0" dy="7" stdDeviation="8" flood-color="#000000" flood-opacity=".62"/>
      </filter>
      <linearGradient id="cardFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#240C33"/>
        <stop offset=".55" stop-color="${purple}"/>
        <stop offset="1" stop-color="#100319"/>
      </linearGradient>
    </defs>
    <g filter="url(#cardShadow)">
      <rect x="${cardX}" y="${cardY}" width="${cardWidth}" height="${cardHeight}"
        rx="14" fill="url(#cardFill)" fill-opacity=".97" stroke="${gold}" stroke-width="3"/>
      <rect x="${cardX + 7}" y="${cardY + 7}" width="${cardWidth - 14}" height="${cardHeight - 14}"
        rx="10" fill="none" stroke="${gold}" stroke-opacity=".48" stroke-width="1"/>
      <text x="${cardX + cardWidth / 2}" y="${cardY + 28}" text-anchor="middle"
        font-family="Avenir Next, Avenir, sans-serif" font-size="18" font-weight="900"
        letter-spacing="2.1" fill="${gold}">SCAN TO RSVP</text>
      <text x="${cardX + cardWidth / 2}" y="${cardY + 47}" text-anchor="middle"
        font-family="Avenir Next, Avenir, sans-serif" font-size="9.5" font-weight="800"
        letter-spacing="1.9" fill="#FFFFFF">RESERVE YOUR SEAT</text>
      <rect x="${qrX - 4}" y="${qrY - 4}" width="${posterQrSize + 8}" height="${posterQrSize + 8}"
        rx="4" fill="#FFFFFF" stroke="${gold}" stroke-width="2"/>
    </g>
  </svg>
`);

const composite = poster.composite([
  { input: cardSvg, left: 0, top: 0 },
  { input: posterQr, left: qrX, top: qrY },
]);

await composite.clone().png({ compressionLevel: 9 }).toFile(posterPngPath);
await composite
  .clone()
  .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
  .toFile(posterJpgPath);

console.log(
  JSON.stringify(
    {
      standaloneQrSize,
      posterQrSize,
      standaloneQrPath,
      posterPngPath,
      posterJpgPath,
    },
    null,
    2,
  ),
);
