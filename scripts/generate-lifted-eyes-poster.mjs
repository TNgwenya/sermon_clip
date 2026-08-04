import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = "/Users/thabangngwenya/Development/Projects/sermon_clip";
const outputDir = path.join(
  projectRoot,
  "design",
  "special-sunday-looking-unto-jesus",
  "lifted-eyes",
);

const sources = {
  background: path.join(outputDir, "reference-inspired-airy-background-v3.png"),
  pastors: path.join(outputDir, "pastors-cutout-green-despill.png"),
  guest:
    "/var/folders/6b/ntzn_cgs7tg7pszwmd6qht300000gn/T/codex-clipboard-b33a56fd-344e-43b5-b9d1-aa9c76c2c66c.jpg",
  logo: path.join(
    projectRoot,
    "public",
    "uploads",
    "branding",
    "church-logo-1782927847716.png",
  ),
};

const width = 1080;
const height = 1350;

const palette = {
  navy: "#06172B",
  navyDeep: "#031023",
  blue: "#0B5DA8",
  cyan: "#78D9EA",
  green: "#A8D876",
  gold: "#E8B957",
  ivory: "#FFF8E8",
  white: "#FFFFFF",
};

function svgBuffer(svg) {
  return Buffer.from(svg);
}

async function prepareLogoMark(markWidth) {
  const crop = await sharp(sources.logo)
    .extract({ left: 560, top: 110, width: 880, height: 850 })
    .png()
    .toBuffer();

  return sharp(crop)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width: markWidth, fit: "contain" })
    .modulate({ brightness: 1.12, saturation: 1.02 })
    .png()
    .toBuffer();
}

function isBackgroundPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return min >= 220 && max - min <= 36;
}

async function prepareGuest(targetWidth) {
  const { data, info } = await sharp(sources.guest)
    .rotate()
    .resize({ width: targetWidth, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: sourceWidth, height: sourceHeight, channels } = info;
  const seen = new Uint8Array(sourceWidth * sourceHeight);
  const queue = new Int32Array(sourceWidth * sourceHeight);
  let head = 0;
  let tail = 0;

  function enqueue(x, y) {
    if (x < 0 || y < 0 || x >= sourceWidth || y >= sourceHeight) return;
    const pixel = y * sourceWidth + x;
    if (seen[pixel]) return;
    const offset = pixel * channels;
    if (
      !isBackgroundPixel(
        data[offset],
        data[offset + 1],
        data[offset + 2],
      )
    ) {
      return;
    }
    seen[pixel] = 1;
    queue[tail++] = pixel;
  }

  for (let x = 0; x < sourceWidth; x += 1) {
    enqueue(x, 0);
    enqueue(x, sourceHeight - 1);
  }
  for (let y = 0; y < sourceHeight; y += 1) {
    enqueue(0, y);
    enqueue(sourceWidth - 1, y);
  }

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % sourceWidth;
    const y = Math.floor(pixel / sourceWidth);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const alpha = Buffer.alloc(sourceWidth * sourceHeight);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = seen[i] ? 0 : 255;
  }

  const { data: softAlpha, info: alphaInfo } = await sharp(alpha, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 1 },
  })
    .blur(0.65)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const foreground = await sharp(data, { raw: info }).png().toBuffer();
  const mask = Buffer.alloc(sourceWidth * sourceHeight * 4, 255);
  for (let i = 0; i < sourceWidth * sourceHeight; i += 1) {
    mask[i * 4 + 3] = softAlpha[i * alphaInfo.channels];
  }

  const maskPng = await sharp(mask, {
    raw: { width: sourceWidth, height: sourceHeight, channels: 4 },
  })
    .png()
    .toBuffer();

  return sharp(foreground)
    .ensureAlpha()
    .composite([{ input: maskPng, blend: "dest-in" }])
    .png()
    .toBuffer();
}

async function fadePortrait(input, targetWidth, fadeStart = 0.78) {
  const resized = await sharp(input)
    .resize({ width: targetWidth, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const fadeY = Math.round(meta.height * fadeStart);

  const mask = svgBuffer(`
    <svg width="${meta.width}" height="${meta.height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#fff" stop-opacity="1"/>
          <stop offset="${fadeStart}" stop-color="#fff" stop-opacity="1"/>
          <stop offset="1" stop-color="#fff" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <rect width="${meta.width}" height="${meta.height}" fill="url(#fade)"/>
    </svg>
  `);

  return {
    width: meta.width,
    height: meta.height,
    buffer: await sharp(resized)
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer(),
    fadeY,
  };
}

function atmosphereOverlay() {
  return svgBuffer(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="leftWash" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="#FFFFFF" stop-opacity=".84"/>
          <stop offset=".52" stop-color="#FFFFFF" stop-opacity=".48"/>
          <stop offset=".78" stop-color="#FFFFFF" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="bottomWash" x1="0" y1="0" x2="0" y2="1">
          <stop offset=".58" stop-color="#FFFFFF" stop-opacity="0"/>
          <stop offset=".78" stop-color="#FFFFFF" stop-opacity=".56"/>
          <stop offset="1" stop-color="#FFFFFF" stop-opacity=".94"/>
        </linearGradient>
        <filter id="atmosphereBlur">
          <feGaussianBlur stdDeviation="38"/>
        </filter>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#leftWash)"/>
      <rect width="${width}" height="${height}" fill="url(#bottomWash)"/>
      <ellipse cx="345" cy="300" rx="390" ry="250" fill="#B9DFF1" fill-opacity=".17" filter="url(#atmosphereBlur)"/>
      <ellipse cx="885" cy="275" rx="330" ry="270" fill="#E8C86F" fill-opacity=".14" filter="url(#atmosphereBlur)"/>
      <path d="M0 1010 C260 940 530 1000 720 920 C860 860 960 865 1080 900 L1080 1350 L0 1350 Z"
        fill="#FFFFFF" fill-opacity=".35"/>
    </svg>
  `);
}

function portraitGlow() {
  return svgBuffer(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="blur">
          <feGaussianBlur stdDeviation="25"/>
        </filter>
      </defs>
      <ellipse cx="286" cy="650" rx="290" ry="320" fill="#FFFDF8" fill-opacity=".62" filter="url(#blur)"/>
      <ellipse cx="770" cy="825" rx="345" ry="285" fill="#DCEEF8" fill-opacity=".25" filter="url(#blur)"/>
    </svg>
  `);
}

function posterTypography() {
  return svgBuffer(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="titleBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0C7CC0"/>
          <stop offset=".55" stop-color="#165AA4"/>
          <stop offset="1" stop-color="#6BAE45"/>
        </linearGradient>
        <filter id="titleShadow" x="-25%" y="-25%" width="150%" height="170%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#FFFFFF" flood-opacity=".95"/>
          <feDropShadow dx="0" dy="7" stdDeviation="7" flood-color="#476174" flood-opacity=".22"/>
        </filter>
        <filter id="softShadow" x="-25%" y="-25%" width="150%" height="170%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="#FFFFFF" flood-opacity=".96"/>
          <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#5D6F7C" flood-opacity=".15"/>
        </filter>
      </defs>

      <g font-family="Avenir Next, Avenir, sans-serif">
        <rect x="0" y="1090" width="${width}" height="260" fill="#FFFFFF" fill-opacity=".9"/>
        <line x1="57" y1="1090" x2="1023" y2="1090" stroke="#0C74B7" stroke-opacity=".42" stroke-width="2"/>

        <text x="540" y="116" text-anchor="middle" fill="${palette.navy}" font-size="23" font-weight="850" letter-spacing="3">RENEWED LIFE INTERNATIONAL</text>
        <text x="540" y="153" text-anchor="middle" fill="#0C74B7" font-size="14" font-weight="900" letter-spacing="6">YOU’RE INVITED</text>

        <g filter="url(#softShadow)">
          <rect x="620" y="930" width="396" height="70" rx="4" fill="#FFFFFF" fill-opacity=".9"/>
          <rect x="620" y="930" width="6" height="70" rx="3" fill="#0C74B7"/>
          <text x="641" y="956" fill="#0C74B7" font-size="11" font-weight="900" letter-spacing="2.5">HOSTS</text>
          <text x="641" y="985" fill="${palette.navy}" font-size="20" font-weight="900">PST T &amp; Z NGWENYA</text>
        </g>

        <text x="540" y="226" text-anchor="middle" fill="url(#titleBlue)" font-family="Snell Roundhand, Apple Chancery, cursive"
          font-size="78" font-weight="700" filter="url(#titleShadow)">Looking unto</text>
        <text x="540" y="350" text-anchor="middle" fill="${palette.navy}" font-family="DIN Condensed, Avenir Next Condensed, sans-serif"
          font-size="132" font-weight="900" letter-spacing="-1" filter="url(#titleShadow)">JESUS</text>
        <g filter="url(#softShadow)">
          <rect x="352" y="364" width="376" height="43" rx="21.5" fill="${palette.navy}" fill-opacity=".96"/>
        </g>
        <text x="540" y="393" text-anchor="middle" fill="${palette.white}" font-size="19" font-weight="900" letter-spacing="6.5">SPECIAL SUNDAY</text>
        <text x="540" y="426" text-anchor="middle" fill="#0C74B7" font-size="13" font-weight="900" letter-spacing="4">HEBREWS 12:2</text>
        <g filter="url(#softShadow)">
          <rect x="560" y="505" width="462" height="56" rx="6" fill="#FFFFFF" fill-opacity=".88"/>
          <rect x="560" y="505" width="6" height="56" rx="3" fill="#77B84A"/>
          <text x="582" y="540" fill="${palette.navy}" font-size="14" font-weight="900" letter-spacing="1.4">WORSHIP</text>
          <circle cx="673" cy="535" r="3.5" fill="#0C74B7"/>
          <text x="688" y="540" fill="${palette.navy}" font-size="14" font-weight="900" letter-spacing="1.4">THE WORD</text>
          <circle cx="793" cy="535" r="3.5" fill="#77B84A"/>
          <text x="808" y="540" fill="#77B84A" font-size="14" font-weight="900" letter-spacing="1.4">HOLY COMMUNION</text>
        </g>

        <g filter="url(#softShadow)">
          <rect x="58" y="690" width="396" height="74" rx="4" fill="#FFFFFF" fill-opacity=".92"/>
          <rect x="58" y="690" width="6" height="74" rx="3" fill="#77B84A"/>
          <text x="79" y="717" fill="#77B84A" font-size="11" font-weight="900" letter-spacing="2.1">GUEST WORSHIP MINISTER</text>
          <text x="79" y="748" fill="${palette.navy}" font-size="23" font-weight="900">MINISTER GIFT ELISHA</text>
        </g>

        <text x="57" y="1128" fill="#77B84A" font-size="12" font-weight="900" letter-spacing="3">DATE</text>
        <text x="57" y="1166" fill="${palette.navy}" font-size="27" font-weight="900">SUNDAY, 2 AUGUST 2026</text>

        <text x="445" y="1128" fill="#0C74B7" font-size="12" font-weight="900" letter-spacing="3">SERVICE TIME</text>
        <text x="445" y="1166" fill="${palette.navy}" font-size="25" font-weight="900">10:00 AM – 1:00 PM</text>

        <text x="770" y="1128" fill="#77B84A" font-size="12" font-weight="900" letter-spacing="3">VENUE</text>
        <text x="770" y="1165" fill="${palette.navy}" font-size="25" font-weight="900">MAMPURU HALL</text>
        <text x="770" y="1193" fill="#455965" font-size="15" font-weight="750">01621 SOBUZA STREET, DUBE</text>

        <line x1="57" y1="1234" x2="1023" y2="1234" stroke="#0C74B7" stroke-opacity=".28" stroke-width="2"/>
        <text x="57" y="1284" fill="${palette.navy}" font-size="18" font-weight="900" letter-spacing="3.6">BELIEVE  •  BELONG  •  BECOME</text>
        <text x="1023" y="1284" text-anchor="end" fill="#0C74B7" font-size="18" font-weight="900" letter-spacing="2.8">#GREATERIMPACT</text>
      </g>
    </svg>
  `);
}

await fs.mkdir(outputDir, { recursive: true });

const background = await sharp(sources.background)
  .resize({ width, height, fit: "cover", position: "center" })
  .modulate({ saturation: 1.02, brightness: 0.96 })
  .png()
  .toBuffer();

const [logo, pastors, guestRaw] = await Promise.all([
  prepareLogoMark(82),
  fadePortrait(sources.pastors, 650, 0.7),
  prepareGuest(468),
]);
const guest = await fadePortrait(guestRaw, 468, 0.76);

const poster = sharp(background).composite([
  { input: atmosphereOverlay(), left: 0, top: 0 },
  { input: portraitGlow(), left: 0, top: 0 },
  { input: guest.buffer, left: 42, top: 410 },
  { input: pastors.buffer, left: 430, top: 600 },
  { input: logo, left: 499, top: 10 },
  { input: posterTypography(), left: 0, top: 0 },
]);

const pngPath = path.join(
  outputDir,
  "looking-unto-jesus-scroll-stopping-polish-v12-instagram-1080x1350.png",
);
const jpgPath = path.join(
  outputDir,
  "looking-unto-jesus-scroll-stopping-polish-v12-instagram-1080x1350.jpg",
);

await poster.clone().png({ compressionLevel: 9 }).toFile(pngPath);
await poster
  .clone()
  .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
  .toFile(jpgPath);

console.log(JSON.stringify({ pngPath, jpgPath }, null, 2));
