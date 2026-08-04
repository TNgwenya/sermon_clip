import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const sourceDir = path.join(campaignDir, "sources");
const outputDir = path.join(campaignDir, "beautiful");
const logoPath = path.join(
  projectRoot,
  "public/uploads/branding/church-logo-1782126430125.png",
);
const qrPath = path.join(
  projectRoot,
  "design/department-volunteer-posters/qr-code.png",
);

const width = 1080;
const height = 1350;
const cardWidth = 900;
const cardHeight = 440;
const cardLeft = 90;
const cardTop = 465;

await fs.mkdir(outputDir, { recursive: true });

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const svg = (content) =>
  Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="deepShadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="16" stdDeviation="19"
                        flood-color="#000000" flood-opacity="0.48"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="7" stdDeviation="10"
                        flood-color="#000000" flood-opacity="0.32"/>
        </filter>
        <linearGradient id="backdropShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#061725" stop-opacity="0.84"/>
          <stop offset="46%" stop-color="#061725" stop-opacity="0.63"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.95"/>
        </linearGradient>
        <linearGradient id="photoSheen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.08"/>
          <stop offset="45%" stop-color="#ffffff" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.24"/>
        </linearGradient>
      </defs>
      ${content}
    </svg>
  `);

const rawLogoCrop = await sharp(logoPath)
  .extract({ left: 0, top: 0, width: 2000, height: 940 })
  .png()
  .toBuffer();
const trimmedLogo = await sharp(rawLogoCrop).trim().png().toBuffer();
const logoMask = Buffer.from(`
  <svg width="96" height="96" viewBox="0 0 96 96"
       xmlns="http://www.w3.org/2000/svg">
    <circle cx="48" cy="48" r="46" fill="#ffffff"/>
  </svg>
`);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 96, height: 96, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();
const qrBuffer = await sharp(qrPath)
  .resize({ width: 164, height: 164, fit: "contain" })
  .png()
  .toBuffer();
const photoMask = Buffer.from(`
  <svg width="${cardWidth}" height="${cardHeight}" viewBox="0 0 ${cardWidth} ${cardHeight}"
       xmlns="http://www.w3.org/2000/svg">
    <rect width="${cardWidth}" height="${cardHeight}" rx="34" fill="#ffffff"/>
  </svg>
`);

const posters = [
  {
    source: "hospitality.jpg",
    filename: "hospitality-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#f1a640",
    accentSoft: "#ffd99a",
    department: "HOSPITALITY TEAM",
    message: [
      "Your welcome can help someone feel seen,",
      "valued and at home.",
    ],
    brightness: 1.08,
    position: "centre",
  },
  {
    source: "praise-worship-v2.jpg",
    filename: "praise-worship-saved-to-serve.png",
    crop: { left: 0, top: 0, width: 1280, height: 718 },
    accent: "#a979ff",
    accentSoft: "#e0ccff",
    department: "PRAISE & WORSHIP TEAM",
    message: [
      "Use your gift to help lead God’s people",
      "into worship.",
    ],
    brightness: 1.06,
    position: "centre",
  },
  {
    source: "ushers.jpg",
    filename: "ushers-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#dfb85f",
    accentSoft: "#f5e0a6",
    department: "USHERS TEAM",
    message: [
      "Your service helps create an atmosphere",
      "of order, care and excellence.",
    ],
    brightness: 1.1,
    position: "north",
  },
  {
    source: "security.jpg",
    filename: "security-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#5ec8ff",
    accentSoft: "#c3edff",
    department: "SECURITY TEAM",
    message: [
      "Your watchfulness helps create a safe",
      "and peaceful place for every family.",
    ],
    brightness: 1.32,
    position: "centre",
  },
];

const makeCroppedSource = async (poster) =>
  sharp(path.join(sourceDir, poster.source))
    .extract(poster.crop)
    .modulate({ brightness: poster.brightness, saturation: 0.98 })
    .sharpen({ sigma: 0.95 })
    .png()
    .toBuffer();

const makeBackdrop = async (source) =>
  sharp(source)
    .resize(width, height, { fit: "cover", position: "centre" })
    .blur(30)
    .modulate({ brightness: 0.58, saturation: 0.84 })
    .png()
    .toBuffer();

const makePhotoCard = async (poster, source) =>
  sharp(source)
    .resize(cardWidth, cardHeight, {
      fit: "cover",
      position: poster.position,
    })
    .composite([{ input: photoMask, blend: "dest-in" }])
    .png()
    .toBuffer();

for (const poster of posters) {
  const source = await makeCroppedSource(poster);
  const backdrop = await makeBackdrop(source);
  const photoCard = await makePhotoCard(poster, source);

  const overlay = svg(`
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#backdropShade)"/>
    <circle cx="972" cy="246" r="245" fill="${poster.accent}" opacity="0.10"/>
    <circle cx="977" cy="247" r="160" fill="none"
            stroke="${poster.accent}" stroke-width="2" opacity="0.24"/>
    <rect x="0" y="0" width="15" height="${height}" fill="${poster.accent}"/>

    <text x="160" y="72" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="26" font-weight="700" letter-spacing="3.5">
      RENEWED LIFE INTERNATIONAL
    </text>
    <text x="1016" y="72" text-anchor="end" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="19" font-weight="900" letter-spacing="2.8">
      MARK 10:45
    </text>
    <line x1="160" y1="96" x2="1016" y2="96"
          stroke="${poster.accent}" stroke-width="2.5"/>

    <text x="58" y="255" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="116" font-weight="900" letter-spacing="-2">
      SAVED
    </text>
    <text x="58" y="363" fill="${poster.accent}"
          font-family="Georgia, Times New Roman, serif"
          font-size="99" font-style="italic" font-weight="700">
      to serve.
    </text>

    <rect x="596" y="333" width="420" height="52" rx="26"
          fill="#061725" opacity="0.80" stroke="${poster.accent}" stroke-width="2"/>
    <text x="806" y="368" text-anchor="middle" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="1.8">
      ${escapeXml(poster.department)}
    </text>

    <rect x="${cardLeft - 8}" y="${cardTop - 8}" width="${cardWidth + 16}"
          height="${cardHeight + 16}" rx="42" fill="#061725"
          stroke="${poster.accent}" stroke-width="4" filter="url(#deepShadow)"/>
    <rect x="${cardLeft}" y="${cardTop}" width="${cardWidth}" height="${cardHeight}"
          rx="34" fill="url(#photoSheen)"/>

    <rect x="42" y="916" width="996" height="395" rx="38"
          fill="#061725" opacity="0.95" stroke="${poster.accent}" stroke-width="2.5"
          filter="url(#softShadow)"/>
    <rect x="74" y="944" width="92" height="6" rx="3" fill="${poster.accent}"/>

    <text x="74" y="1001" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="29" font-weight="650">
      <tspan x="74" dy="0">${escapeXml(poster.message[0])}</tspan>
      <tspan x="74" dy="40">${escapeXml(poster.message[1])}</tspan>
    </text>

    <text x="74" y="1092" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="18" font-weight="650">
      <tspan x="74" dy="0">“For even the Son of Man did not come to be served,</tspan>
      <tspan x="74" dy="26">but to serve, and to give his life as a ransom for many.”</tspan>
      <tspan x="74" dy="26" font-weight="900">— Mark 10:45</tspan>
    </text>
    <rect x="74" y="1163" width="370" height="64" rx="32"
          fill="${poster.accent}" filter="url(#softShadow)"/>
    <text x="259" y="1207" text-anchor="middle" fill="#061725"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="26" font-weight="900" letter-spacing="1.2">
      TAKE YOUR NEXT STEP
    </text>

    <text x="74" y="1262" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="20" font-weight="800" letter-spacing="0.5">
      SCAN THE QR CODE OR TAP THE LINK IN THE CAPTION
    </text>
    <text x="74" y="1300" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="19" font-weight="800" letter-spacing="2">
      BELIEVE • BELONG • BECOME
    </text>
    <text x="1010" y="1300" text-anchor="end" fill="${poster.accent}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="19" font-weight="900" letter-spacing="2">
      #GREATERIMPACT
    </text>

    <text x="923" y="1050" text-anchor="middle" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="17" font-weight="900" letter-spacing="2.5">
      SCAN TO SERVE
    </text>
  `);

  await sharp(backdrop)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: photoCard, left: cardLeft, top: cardTop },
      { input: logoBuffer, left: 48, top: 22 },
      { input: qrBuffer, left: 840, top: 1060 },
    ])
    .png({ quality: 100 })
    .toFile(path.join(outputDir, poster.filename));
}

console.log(`Created beautiful Saved to Serve poster family in ${outputDir}`);
