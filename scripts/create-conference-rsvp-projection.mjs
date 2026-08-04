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
const qrPath = path.join(outputDir, "conference-rsvp-qr.png");
const outputPng = path.join(
  outputDir,
  "crowned-conference-rsvp-projection-1920x1080.png",
);
const outputJpg = path.join(
  outputDir,
  "crowned-conference-rsvp-projection-1920x1080.jpg",
);

const canvasWidth = 1920;
const canvasHeight = 1080;
const posterX = 42;
const posterY = 40;
const posterHeight = 1000;
const posterWidth = 667;
const panelX = 750;
const panelY = 30;
const panelWidth = 1130;
const panelHeight = 1020;
const qrSize = 732;
const qrX = 949;
const qrY = 200;

await fs.mkdir(outputDir, { recursive: true });

const sourceMetadata = await sharp(sourcePoster).rotate().metadata();
if (sourceMetadata.width !== 1024 || sourceMetadata.height !== 1536) {
  throw new Error(
    `Unexpected source poster dimensions: ${sourceMetadata.width}x${sourceMetadata.height}`,
  );
}

const qrMetadata = await sharp(qrPath).metadata();
if (qrMetadata.width !== qrSize || qrMetadata.height !== qrSize) {
  throw new Error(
    `Expected a ${qrSize}x${qrSize} QR, received ${qrMetadata.width}x${qrMetadata.height}`,
  );
}

const blurredBackground = await sharp(sourcePoster)
  .rotate()
  .resize(canvasWidth, canvasHeight, { fit: "cover" })
  .blur(34)
  .modulate({ brightness: 0.4, saturation: 0.78 })
  .toBuffer();

const poster = await sharp(sourcePoster)
  .rotate()
  .resize(posterWidth, posterHeight, { fit: "fill" })
  .toBuffer();

const artSvg = Buffer.from(`
  <svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="screenTint" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#100317" stop-opacity=".73"/>
        <stop offset=".52" stop-color="#24092D" stop-opacity=".82"/>
        <stop offset="1" stop-color="#09010D" stop-opacity=".91"/>
      </linearGradient>
      <radialGradient id="rightGlow" cx=".59" cy=".36" r=".8">
        <stop offset="0" stop-color="#6E234F" stop-opacity=".42"/>
        <stop offset=".46" stop-color="#2A0B34" stop-opacity=".30"/>
        <stop offset="1" stop-color="#100217" stop-opacity=".08"/>
      </radialGradient>
      <linearGradient id="panelFill" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#2F103C" stop-opacity=".96"/>
        <stop offset=".53" stop-color="#180720" stop-opacity=".98"/>
        <stop offset="1" stop-color="#0D0212" stop-opacity=".99"/>
      </linearGradient>
      <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#A56C21"/>
        <stop offset=".26" stop-color="#FFE182"/>
        <stop offset=".52" stop-color="#CB8B31"/>
        <stop offset=".78" stop-color="#FFF0A1"/>
        <stop offset="1" stop-color="#9A5D18"/>
      </linearGradient>
      <filter id="posterShadow" x="-20%" y="-10%" width="150%" height="130%">
        <feDropShadow dx="0" dy="13" stdDeviation="16" flood-color="#000000" flood-opacity=".72"/>
      </filter>
      <filter id="panelShadow" x="-15%" y="-15%" width="140%" height="140%">
        <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#000000" flood-opacity=".70"/>
      </filter>
      <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="10"/>
      </filter>
    </defs>

    <rect width="${canvasWidth}" height="${canvasHeight}" fill="url(#screenTint)"/>
    <rect width="${canvasWidth}" height="${canvasHeight}" fill="url(#rightGlow)"/>

    <g filter="url(#posterShadow)">
      <rect x="${posterX - 5}" y="${posterY - 5}" width="${posterWidth + 10}" height="${posterHeight + 10}"
        rx="6" fill="#100318" stroke="url(#gold)" stroke-width="4"/>
    </g>

    <g filter="url(#panelShadow)">
      <rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${panelHeight}"
        rx="30" fill="url(#panelFill)" stroke="url(#gold)" stroke-width="3"/>
      <rect x="${panelX + 11}" y="${panelY + 11}" width="${panelWidth - 22}" height="${panelHeight - 22}"
        rx="22" fill="none" stroke="#EBC463" stroke-opacity=".25" stroke-width="1"/>
    </g>

    <circle cx="1315" cy="543" r="405" fill="#9D557E" opacity=".13" filter="url(#softGlow)"/>

    <text x="1315" y="108" text-anchor="middle"
      font-family="Avenir Next, Avenir, Helvetica, Arial, sans-serif"
      font-size="58" font-weight="900" letter-spacing="6" fill="url(#gold)">SCAN TO RSVP</text>
    <text x="1315" y="153" text-anchor="middle"
      font-family="Avenir Next, Avenir, Helvetica, Arial, sans-serif"
      font-size="22" font-weight="700" letter-spacing="5.2" fill="#FFFFFF">CROWNED CONFERENCE 2026</text>

    <line x1="980" y1="174" x2="1180" y2="174" stroke="url(#gold)" stroke-width="2"/>
    <circle cx="1315" cy="174" r="5" fill="#E9C368"/>
    <line x1="1450" y1="174" x2="1650" y2="174" stroke="url(#gold)" stroke-width="2"/>

    <rect x="${qrX - 12}" y="${qrY - 12}" width="${qrSize + 24}" height="${qrSize + 24}"
      rx="9" fill="#FFFFFF" stroke="url(#gold)" stroke-width="4"/>

    <text x="1315" y="984" text-anchor="middle"
      font-family="Avenir Next, Avenir, Helvetica, Arial, sans-serif"
      font-size="25" font-weight="800" letter-spacing="3.2" fill="#FFFFFF">POINT YOUR CAMERA AT THE QR CODE</text>
    <text x="1315" y="1021" text-anchor="middle"
      font-family="Avenir Next, Avenir, Helvetica, Arial, sans-serif"
      font-size="18" font-weight="650" letter-spacing="2.3" fill="#EBC86F">RESERVE YOUR SEAT</text>
  </svg>
`);

const composite = sharp(blurredBackground).composite([
  { input: poster, left: posterX, top: posterY },
  { input: artSvg, left: 0, top: 0 },
  { input: poster, left: posterX, top: posterY },
  { input: qrPath, left: qrX, top: qrY },
]);

await composite.clone().png({ compressionLevel: 9 }).toFile(outputPng);
await composite
  .clone()
  .jpeg({ quality: 96, chromaSubsampling: "4:4:4" })
  .toFile(outputJpg);

const totalModules = 61;
const moduleScale = qrSize / totalModules;
if (!Number.isInteger(moduleScale)) {
  throw new Error("QR modules do not map to whole pixels.");
}

const expectedQr = await sharp(qrPath).removeAlpha().raw().toBuffer();
function isDark(buffer, x, y, width) {
  const offset = (y * width + x) * 3;
  const luminance =
    buffer[offset] * 0.2126 +
    buffer[offset + 1] * 0.7152 +
    buffer[offset + 2] * 0.0722;
  return luminance < 128;
}

for (const outputPath of [outputPng, outputJpg]) {
  const outputMetadata = await sharp(outputPath).metadata();
  if (
    outputMetadata.width !== canvasWidth ||
    outputMetadata.height !== canvasHeight
  ) {
    throw new Error(
      `${path.basename(outputPath)} has unexpected dimensions: ${outputMetadata.width}x${outputMetadata.height}`,
    );
  }

  const qrCrop = await sharp(outputPath)
    .extract({ left: qrX, top: qrY, width: qrSize, height: qrSize })
    .removeAlpha()
    .raw()
    .toBuffer();

  let moduleMismatches = 0;
  for (let moduleY = 0; moduleY < totalModules; moduleY += 1) {
    for (let moduleX = 0; moduleX < totalModules; moduleX += 1) {
      const sampleX = moduleX * moduleScale + Math.floor(moduleScale / 2);
      const sampleY = moduleY * moduleScale + Math.floor(moduleScale / 2);
      if (
        isDark(expectedQr, sampleX, sampleY, qrSize) !==
        isDark(qrCrop, sampleX, sampleY, qrSize)
      ) {
        moduleMismatches += 1;
      }
    }
  }

  if (moduleMismatches !== 0) {
    throw new Error(
      `${path.basename(outputPath)} altered ${moduleMismatches} QR modules.`,
    );
  }

  console.log(
    `${path.basename(outputPath)}: ${canvasWidth}x${canvasHeight}; all ${totalModules ** 2} QR module centers verified`,
  );
}

console.log(
  JSON.stringify(
    {
      outputPng,
      outputJpg,
      qr: { x: qrX, y: qrY, size: qrSize },
    },
    null,
    2,
  ),
);
