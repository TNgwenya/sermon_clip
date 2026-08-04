import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const sourceDir = path.join(campaignDir, "sources");
const outputDir = path.join(campaignDir, "final");
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
const photoTop = 500;
const photoHeight = 510;

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
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="10"
                        flood-color="#000000" flood-opacity="0.32"/>
        </filter>
        <linearGradient id="photoTopShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#061725" stop-opacity="0.48"/>
          <stop offset="30%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="78%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.46"/>
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
  <svg width="106" height="106" viewBox="0 0 106 106"
       xmlns="http://www.w3.org/2000/svg">
    <circle cx="53" cy="53" r="51" fill="#ffffff"/>
  </svg>
`);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 106, height: 106, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();
const qrBuffer = await sharp(qrPath)
  .resize({ width: 172, height: 172, fit: "contain" })
  .png()
  .toBuffer();

const posters = [
  {
    source: "hospitality.jpg",
    filename: "hospitality-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#f2a23a",
    accentSoft: "#ffd28b",
    department: "HOSPITALITY TEAM",
    message: [
      "Your welcome can help someone feel seen,",
      "valued and at home.",
    ],
    brightness: 1.06,
  },
  {
    source: "praise-worship-v2.jpg",
    filename: "praise-worship-saved-to-serve.png",
    crop: { left: 0, top: 0, width: 1280, height: 718 },
    accent: "#aa7cff",
    accentSoft: "#dec8ff",
    department: "PRAISE & WORSHIP TEAM",
    message: [
      "Use your gift to help lead God’s people",
      "into worship.",
    ],
    brightness: 1.04,
  },
  {
    source: "ushers.jpg",
    filename: "ushers-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#ddb35f",
    accentSoft: "#f3dc9f",
    department: "USHERS TEAM",
    message: [
      "Your service helps create an atmosphere",
      "of order, care and excellence.",
    ],
    brightness: 1.08,
    position: "north",
  },
  {
    source: "security.jpg",
    filename: "security-saved-to-serve.png",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#5fc7ff",
    accentSoft: "#bceaff",
    department: "SECURITY TEAM",
    message: [
      "Your watchfulness helps create a safe",
      "and peaceful place for every family.",
    ],
    brightness: 1.28,
  },
];

const makePhotoPanel = async (poster) => {
  const cropped = await sharp(path.join(sourceDir, poster.source))
    .extract(poster.crop)
    .modulate({ brightness: poster.brightness, saturation: 0.96 })
    .sharpen({ sigma: 0.9 })
    .png()
    .toBuffer();

  if (!poster.contained) {
    return sharp(cropped)
      .resize(width, photoHeight, {
        fit: "cover",
        position: poster.position ?? "centre",
      })
      .png()
      .toBuffer();
  }

  const blurredBackground = await sharp(cropped)
    .resize(width, photoHeight, { fit: "cover", position: "centre" })
    .blur(18)
    .modulate({ brightness: 0.74, saturation: 1.08 })
    .png()
    .toBuffer();
  const foreground = await sharp(cropped)
    .resize(width, photoHeight, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp(blurredBackground)
    .composite([{ input: foreground, gravity: "centre" }])
    .png()
    .toBuffer();
};

for (const poster of posters) {
  const photoPanel = await makePhotoPanel(poster);
  const base = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: "#061725",
    },
  })
    .png()
    .toBuffer();

  const overlay = svg(`
    <rect x="0" y="0" width="18" height="${height}" fill="${poster.accent}"/>

    <text x="172" y="75" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="700" letter-spacing="3.8">
      RENEWED LIFE INTERNATIONAL
    </text>
    <text x="1016" y="75" text-anchor="end" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="800" letter-spacing="2.6">
      SERVANTHOOD
    </text>
    <line x1="172" y1="103" x2="1017" y2="103"
          stroke="${poster.accent}" stroke-width="3"/>

    <text x="58" y="171" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="4">
      MARK 10:45
    </text>
    <text x="58" y="300" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="126" font-weight="900" letter-spacing="-2">
      SAVED
    </text>
    <text x="58" y="410" fill="${poster.accent}"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="116" font-weight="900" letter-spacing="-2">
      TO SERVE
    </text>

    <rect x="58" y="438" width="520" height="50" rx="25"
          fill="${poster.accent}"/>
    <text x="318" y="472" text-anchor="middle" fill="#061725"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="900" letter-spacing="1.8">
      ${escapeXml(poster.department)}
    </text>

    <rect x="0" y="${photoTop}" width="${width}" height="${photoHeight}"
          fill="url(#photoTopShade)"/>
    <line x1="0" y1="${photoTop}" x2="${width}" y2="${photoTop}"
          stroke="${poster.accent}" stroke-width="6"/>
    <line x1="0" y1="${photoTop + photoHeight}" x2="${width}" y2="${photoTop + photoHeight}"
          stroke="${poster.accent}" stroke-width="6"/>

    <text x="58" y="1074" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="29" font-weight="650">
      <tspan x="58" dy="0">${escapeXml(poster.message[0])}</tspan>
      <tspan x="58" dy="39">${escapeXml(poster.message[1])}</tspan>
    </text>

    <rect x="58" y="1160" width="380" height="72" rx="36"
          fill="${poster.accent}" filter="url(#shadow)"/>
    <text x="248" y="1209" text-anchor="middle" fill="#061725"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="900" letter-spacing="1.2">
      TAKE YOUR NEXT STEP
    </text>
    <text x="58" y="1271" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="800" letter-spacing="0.8">
      SCAN THE QR CODE OR FOLLOW THE LINK
    </text>
    <text x="58" y="1321" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="800" letter-spacing="2.2">
      SERVE • GROW • MAKE AN IMPACT
    </text>
    <text x="1018" y="1321" text-anchor="end" fill="${poster.accent}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="900" letter-spacing="2">
      #GREATER IMPACT
    </text>
  `);

  await sharp(base)
    .composite([
      { input: photoPanel, left: 0, top: photoTop },
      { input: overlay, left: 0, top: 0 },
      { input: logoBuffer, left: 52, top: 25 },
      { input: qrBuffer, left: 850, top: 1100 },
    ])
    .png({ quality: 100 })
    .toFile(path.join(outputDir, poster.filename));
}

console.log(`Created Saved to Serve poster family in ${outputDir}`);
