import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const posterDir = path.dirname(currentFile);
const projectRoot = path.resolve(posterDir, "../..");
const backgroundDir = path.join(posterDir, "backgrounds");
const outputDir = path.join(posterDir, "family");
const qrPath = path.join(posterDir, "qr-code.png");
const logoPath = path.join(
  projectRoot,
  "public/uploads/branding/church-logo-1782126430125.png",
);

const width = 1080;
const height = 1350;

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
          <feDropShadow dx="0" dy="10" stdDeviation="12"
                        flood-color="#000000" flood-opacity="0.34"/>
        </filter>
        <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.98"/>
        </linearGradient>
        <linearGradient id="leftPanel" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#061725" stop-opacity="0.98"/>
          <stop offset="80%" stop-color="#061725" stop-opacity="0.88"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.38"/>
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
  <svg width="116" height="116" viewBox="0 0 116 116"
       xmlns="http://www.w3.org/2000/svg">
    <circle cx="58" cy="58" r="56" fill="#ffffff"/>
  </svg>
`);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 116, height: 116, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();
const qrBuffer = await sharp(qrPath)
  .resize({ width: 170, height: 170, fit: "contain" })
  .png()
  .toBuffer();

const posters = [
  {
    background: "hospitality.png",
    filename: "hospitality-volunteers.png",
    accent: "#f2a23a",
    accentSoft: "#ffd18a",
    line1: "HOSPITALITY",
    line2: "TEAM",
    line1Size: 91,
    line2Size: 148,
    tagline: "HELP PEOPLE FEEL AT HOME",
    body1: "Create a warm welcome",
    body2: "for every person.",
    leader: "Hospitality",
    brightness: 0.96,
    panelStart: 0.98,
    panelMid: 0.88,
  },
  {
    background: "praise-worship.png",
    filename: "praise-worship-volunteers.png",
    accent: "#b887ff",
    accentSoft: "#e0c8ff",
    line1: "PRAISE &",
    line2: "WORSHIP",
    line1Size: 105,
    line2Size: 123,
    tagline: "USE YOUR GIFT FOR HIS GLORY",
    body1: "Singers and musicians ready",
    body2: "to serve through worship.",
    leader: "Praise & Worship",
    flip: true,
    brightness: 0.96,
    panelStart: 0.98,
    panelMid: 0.88,
  },
  {
    background: "ushers.png",
    filename: "ushers-volunteers.png",
    accent: "#ddb35f",
    accentSoft: "#f2d99b",
    line1: "USHERS",
    line2: "TEAM",
    line1Size: 144,
    line2Size: 148,
    tagline: "SERVE WITH EXCELLENCE",
    body1: "Create an orderly and welcoming",
    body2: "worship experience.",
    leader: "Ushering",
    brightness: 1.06,
    panelStart: 0.88,
    panelMid: 0.75,
  },
  {
    background: "security.png",
    filename: "security-volunteers.png",
    accent: "#5fc7ff",
    accentSoft: "#b9e8ff",
    line1: "SECURITY",
    line2: "TEAM",
    line1Size: 114,
    line2Size: 148,
    tagline: "SERVE • PROTECT • SUPPORT",
    body1: "Help create a safe and peaceful",
    body2: "place for everyone to worship.",
    leader: "Security",
    brightness: 1.06,
    panelStart: 0.88,
    panelMid: 0.75,
  },
];

const makeBackground = async ({ background, flip, brightness }) => {
  let pipeline = sharp(path.join(backgroundDir, background))
    .resize(width, height, { fit: "cover", position: "centre" })
    .modulate({ saturation: 0.86, brightness });
  if (flip) pipeline = pipeline.flop();
  return pipeline.png().toBuffer();
};

for (const poster of posters) {
  const background = await makeBackground(poster);
  const overlay = svg(`
    <defs>
      <linearGradient id="departmentPanel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#061725" stop-opacity="${poster.panelStart}"/>
        <stop offset="80%" stop-color="#061725" stop-opacity="${poster.panelMid}"/>
        <stop offset="100%" stop-color="#061725" stop-opacity="0.34"/>
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="#061725" opacity="0.18"/>
    <path d="M0 0 H770 L650 980 H0 Z" fill="url(#departmentPanel)"/>
    <rect x="0" y="1010" width="${width}" height="340" fill="url(#bottomFade)"/>
    <rect x="0" y="0" width="18" height="${height}" fill="${poster.accent}"/>

    <text x="185" y="83" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="700" letter-spacing="4">
      RENEWED LIFE INTERNATIONAL
    </text>
    <line x1="185" y1="107" x2="681" y2="107"
          stroke="${poster.accent}" stroke-width="3"/>

    <rect x="58" y="166" width="300" height="48" rx="24"
          fill="${poster.accent}"/>
    <text x="208" y="199" text-anchor="middle" fill="#061725"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="2">
      VOLUNTEERS NEEDED
    </text>

    <text x="58" y="340" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="${poster.line1Size}" font-weight="900" letter-spacing="-1">
      ${escapeXml(poster.line1)}
    </text>
    <text x="58" y="475" fill="${poster.accent}"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="${poster.line2Size}" font-weight="900" letter-spacing="-2">
      ${escapeXml(poster.line2)}
    </text>

    <line x1="60" y1="518" x2="475" y2="518"
          stroke="${poster.accent}" stroke-width="5"/>
    <text x="60" y="573" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="26" font-weight="900" letter-spacing="2">
      ${escapeXml(poster.tagline)}
    </text>
    <text x="60" y="635" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="30" font-weight="500">
      <tspan x="60" dy="0">${escapeXml(poster.body1)}</tspan>
      <tspan x="60" dy="42">${escapeXml(poster.body2)}</tspan>
    </text>

    <rect x="58" y="1064" width="365" height="76" rx="38"
          fill="${poster.accent}" filter="url(#shadow)"/>
    <text x="241" y="1115" text-anchor="middle" fill="#061725"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="1.4">
      READY TO SERVE?
    </text>
    <text x="58" y="1203" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="800" letter-spacing="0.7">
      SCAN THE QR CODE OR FOLLOW THE LINK
    </text>

    <text x="58" y="1292" fill="${poster.accentSoft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="800" letter-spacing="2.4">
      SERVE • GROW • MAKE AN IMPACT
    </text>
    <text x="1018" y="1292" text-anchor="end" fill="${poster.accent}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="2.2">
      #GREATER IMPACT
    </text>
  `);

  await sharp(background)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: logoBuffer, left: 54, top: 34 },
      { input: qrBuffer, left: 852, top: 1041 },
    ])
    .png({ quality: 100 })
    .toFile(path.join(outputDir, poster.filename));
}

console.log(`Created coordinated poster family in ${outputDir}`);
