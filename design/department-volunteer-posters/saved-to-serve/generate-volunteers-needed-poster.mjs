import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const sourceDir = path.join(campaignDir, "sources");
const outputDir = path.join(campaignDir, "beautiful");
const outputPath = path.join(outputDir, "volunteers-needed-saved-to-serve.png");
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
const tileWidth = 464;
const tileHeight = 250;

await fs.mkdir(outputDir, { recursive: true });

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const makeSvg = (content, svgWidth = width, svgHeight = height) =>
  Buffer.from(`
    <svg width="${svgWidth}" height="${svgHeight}"
         viewBox="0 0 ${svgWidth} ${svgHeight}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="deepShadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="14" stdDeviation="18"
                        flood-color="#000000" flood-opacity="0.48"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="7" stdDeviation="10"
                        flood-color="#000000" flood-opacity="0.32"/>
        </filter>
        <linearGradient id="pageGradient" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#061725"/>
          <stop offset="52%" stop-color="#0b2234"/>
          <stop offset="100%" stop-color="#071624"/>
        </linearGradient>
        <linearGradient id="titleGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#f1a640"/>
          <stop offset="36%" stop-color="#dfb85f"/>
          <stop offset="68%" stop-color="#a979ff"/>
          <stop offset="100%" stop-color="#5ec8ff"/>
        </linearGradient>
        <linearGradient id="photoFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="48%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.92"/>
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
  '<circle cx="48" cy="48" r="46" fill="#ffffff"/>',
  96,
  96,
);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 96, height: 96, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const qrBuffer = await sharp(qrPath)
  .resize({ width: 252, height: 252, fit: "contain" })
  .png()
  .toBuffer();

const tileMask = makeSvg(
  `<rect width="${tileWidth}" height="${tileHeight}" rx="28" fill="#ffffff"/>`,
  tileWidth,
  tileHeight,
);

const departments = [
  {
    name: "HOSPITALITY",
    source: "hospitality.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#f1a640",
    position: "centre",
    brightness: 1.08,
    left: 66,
    top: 377,
  },
  {
    name: "PRAISE & WORSHIP",
    source: "praise-worship-v2.jpg",
    crop: { left: 0, top: 0, width: 1280, height: 718 },
    accent: "#a979ff",
    position: "centre",
    brightness: 1.06,
    left: 550,
    top: 377,
  },
  {
    name: "USHERS",
    source: "ushers.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#dfb85f",
    position: "north",
    brightness: 1.1,
    left: 66,
    top: 647,
  },
  {
    name: "SECURITY",
    source: "security.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#5ec8ff",
    position: "centre",
    brightness: 1.32,
    left: 550,
    top: 647,
  },
];

const makeTile = async (department) => {
  const image = await sharp(path.join(sourceDir, department.source))
    .extract(department.crop)
    .modulate({ brightness: department.brightness, saturation: 0.98 })
    .sharpen({ sigma: 0.95 })
    .resize(tileWidth, tileHeight, {
      fit: "cover",
      position: department.position,
    })
    .png()
    .toBuffer();

  const label = makeSvg(
    `
      <defs>
        <linearGradient id="tileFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="42%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.96"/>
        </linearGradient>
      </defs>
      <rect width="${tileWidth}" height="${tileHeight}" fill="url(#tileFade)"/>
      <rect x="22" y="190" width="58" height="5" rx="2.5"
            fill="${department.accent}"/>
      <text x="22" y="225" fill="#ffffff"
            font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
            font-size="21" font-weight="900" letter-spacing="1.8">
        ${escapeXml(department.name)}
      </text>
    `,
    tileWidth,
    tileHeight,
  );

  return sharp(image)
    .composite([
      { input: label, left: 0, top: 0 },
      { input: tileMask, blend: "dest-in" },
    ])
    .png()
    .toBuffer();
};

const tiles = await Promise.all(departments.map(makeTile));

const layout = makeSvg(`
  <rect width="${width}" height="${height}" fill="url(#pageGradient)"/>
  <circle cx="950" cy="176" r="242" fill="#f1a640" opacity="0.07"/>
  <circle cx="973" cy="190" r="158" fill="none"
          stroke="#f1a640" stroke-width="2" opacity="0.20"/>
  <circle cx="75" cy="710" r="230" fill="#a979ff" opacity="0.05"/>
  <rect x="0" y="0" width="15" height="${height}" fill="url(#titleGradient)"/>

  <text x="160" y="72" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="26" font-weight="700" letter-spacing="3.5">
    RENEWED LIFE INTERNATIONAL
  </text>
  <text x="1016" y="72" text-anchor="end" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="19" font-weight="900" letter-spacing="2.8">
    MARK 10:45
  </text>
  <line x1="160" y1="96" x2="1016" y2="96"
        stroke="url(#titleGradient)" stroke-width="2.5"/>

  <text x="58" y="190" fill="#ffffff"
        font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
        font-size="81" font-weight="900" letter-spacing="-1">
    VOLUNTEERS
  </text>
  <text x="58" y="292" fill="url(#titleGradient)"
        font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
        font-size="111" font-weight="900" letter-spacing="-2">
    NEEDED
  </text>
  <rect x="678" y="224" width="338" height="58" rx="29"
        fill="#061725" opacity="0.82" stroke="#f1a640" stroke-width="2"/>
  <text x="847" y="262" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="21" font-weight="900" letter-spacing="2.8">
    SAVED TO SERVE
  </text>

  ${departments
    .map(
      (department) => `
        <rect x="${department.left - 5}" y="${department.top - 5}"
              width="${tileWidth + 10}" height="${tileHeight + 10}" rx="33"
              fill="#061725" stroke="${department.accent}" stroke-width="3"
              filter="url(#deepShadow)"/>
      `,
    )
    .join("")}

  <rect x="42" y="928" width="996" height="383" rx="38"
        fill="#061725" opacity="0.97" stroke="#dfb85f" stroke-width="2.5"
        filter="url(#softShadow)"/>
  <rect x="74" y="956" width="92" height="6" rx="3" fill="#f1a640"/>
  <rect x="914" y="956" width="92" height="6" rx="3" fill="#5ec8ff"/>

  <text x="540" y="996" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="29" font-weight="800" letter-spacing="0.4">
    THERE IS A PLACE FOR YOU TO SERVE.
  </text>

  <text x="74" y="1050" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="17" font-weight="900" letter-spacing="2">
    SAVED TO SERVE
  </text>
  <text x="74" y="1090" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="800">
    YOUR HEART.
  </text>
  <text x="74" y="1123" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="800">
    YOUR GIFTS.
  </text>
  <text x="74" y="1156" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="800">
    YOUR YES.
  </text>
  <text x="74" y="1204" fill="#d8e5ee"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="16" font-weight="600">
    Join a ministry team and
  </text>
  <text x="74" y="1228" fill="#d8e5ee"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="16" font-weight="600">
    make a greater impact.
  </text>

  <text x="724" y="1050" fill="#5ec8ff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="17" font-weight="900" letter-spacing="2">
    MARK 10:45
  </text>
  <text x="724" y="1090" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="16" font-weight="650">
    “The Son of Man did not
  </text>
  <text x="724" y="1115" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="16" font-weight="650">
    come to be served, but
  </text>
  <text x="724" y="1140" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="16" font-weight="650">
    to serve...”
  </text>
  <text x="724" y="1190" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="900" letter-spacing="1.5">
    BELIEVE
  </text>
  <text x="724" y="1218" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="900" letter-spacing="1.5">
    BELONG
  </text>
  <text x="724" y="1246" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="900" letter-spacing="1.5">
    BECOME
  </text>

  <text x="540" y="1289" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="17" font-weight="850" letter-spacing="0.8">
    SCAN TO JOIN A DEPARTMENT • OR TAP THE LINK IN THE CAPTION
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
    ...tiles.map((tile, index) => ({
      input: tile,
      left: departments[index].left,
      top: departments[index].top,
    })),
    { input: logoBuffer, left: 48, top: 22 },
    { input: qrBuffer, left: 414, top: 1016 },
  ])
  .png({ quality: 100 })
  .toFile(outputPath);

console.log(`Created ${outputPath}`);
