import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const outputDir = path.join(campaignDir, "beautiful");
const outputPath = path.join(outputDir, "volunteers-needed-qr-only.png");
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

await fs.mkdir(outputDir, { recursive: true });

const makeSvg = (content, svgWidth = width, svgHeight = height) =>
  Buffer.from(`
    <svg width="${svgWidth}" height="${svgHeight}"
         viewBox="0 0 ${svgWidth} ${svgHeight}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="18" stdDeviation="24"
                        flood-color="#000000" flood-opacity="0.5"/>
        </filter>
        <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="40"/>
        </filter>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#061725"/>
          <stop offset="52%" stop-color="#0b2234"/>
          <stop offset="100%" stop-color="#071624"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#f1a640"/>
          <stop offset="34%" stop-color="#dfb85f"/>
          <stop offset="68%" stop-color="#a979ff"/>
          <stop offset="100%" stop-color="#5ec8ff"/>
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
const logoMask = makeSvg(
  '<circle cx="49" cy="49" r="47" fill="#ffffff"/>',
  98,
  98,
);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 98, height: 98, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const qrSize = 570;
const qrBuffer = await sharp(qrPath)
  .resize({ width: qrSize, height: qrSize, fit: "contain" })
  .png()
  .toBuffer();

const layout = makeSvg(`
  <rect width="${width}" height="${height}" fill="url(#background)"/>
  <circle cx="90" cy="335" r="245" fill="#a979ff" opacity="0.10"
          filter="url(#softGlow)"/>
  <circle cx="1000" cy="780" r="280" fill="#5ec8ff" opacity="0.09"
          filter="url(#softGlow)"/>
  <circle cx="870" cy="90" r="175" fill="#f1a640" opacity="0.08"/>
  <rect x="0" y="0" width="14" height="${height}" fill="url(#accent)"/>

  <text x="162" y="76" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="750" letter-spacing="3.2">
    RENEWED LIFE INTERNATIONAL
  </text>
  <line x1="162" y1="102" x2="1018" y2="102"
        stroke="url(#accent)" stroke-width="2.5"/>

  <text x="540" y="188" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
        font-size="62" font-weight="900" letter-spacing="0.4">
    VOLUNTEERS NEEDED
  </text>
  <text x="540" y="242" text-anchor="middle" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="22" font-weight="900" letter-spacing="4">
    SAVED TO SERVE
  </text>
  <text x="540" y="294" text-anchor="middle" fill="#d8e5ee"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="24" font-weight="650">
    There is a place for you to serve.
  </text>

  <rect x="223" y="337" width="634" height="634" rx="45"
        fill="#ffffff" stroke="url(#accent)" stroke-width="5"
        filter="url(#shadow)"/>
  <rect x="242" y="356" width="596" height="596" rx="29"
        fill="none" stroke="#061725" stroke-width="2" opacity="0.12"/>

  <rect x="257" y="1016" width="566" height="70" rx="35"
        fill="url(#accent)" filter="url(#shadow)"/>
  <text x="540" y="1062" text-anchor="middle" fill="#061725"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="950" letter-spacing="1.5">
    SCAN TO JOIN A DEPARTMENT
  </text>

  <text x="540" y="1145" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="21" font-weight="750">
    Use your gifts. Bring your heart. Make a greater impact.
  </text>
  <text x="540" y="1192" text-anchor="middle" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="700">
    “The Son of Man did not come to be served, but to serve...” — Mark 10:45
  </text>

  <line x1="170" y1="1241" x2="910" y2="1241"
        stroke="url(#accent)" stroke-width="2.5" opacity="0.8"/>
  <text x="540" y="1293" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="20" font-weight="900" letter-spacing="3.2">
    BELIEVE • BELONG • BECOME
  </text>
`);

await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: "#061725",
  },
})
  .composite([
    { input: layout, left: 0, top: 0 },
    { input: logoBuffer, left: 48, top: 23 },
    { input: qrBuffer, left: 255, top: 369 },
  ])
  .png({ quality: 100 })
  .toFile(outputPath);

console.log(`Created ${outputPath}`);
