import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const sourceDir = path.join(campaignDir, "sources");
const outputDir = path.join(campaignDir, "beautiful", "creative-variations");
const qrPath = path.join(
  projectRoot,
  "design/department-volunteer-posters/qr-code.png",
);
const logoPath = path.join(
  projectRoot,
  "public/uploads/branding/church-logo-1782126430125.png",
);

const width = 1080;
const height = 1920;
const navy = "#061725";
const durations = [4.6, 4.4, 4.4, 5.4, 4.2, 7.5];
const transitionDuration = 0.45;
const offsets = [4.15, 8.1, 12.05, 17.0, 20.75];

await fs.mkdir(outputDir, { recursive: true });

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const svg = (content, svgWidth = width, svgHeight = height) =>
  Buffer.from(`
    <svg width="${svgWidth}" height="${svgHeight}"
         viewBox="0 0 ${svgWidth} ${svgHeight}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="deepShadow" x="-40%" y="-40%" width="190%" height="210%">
          <feDropShadow dx="0" dy="22" stdDeviation="28"
                        flood-color="#000000" flood-opacity="0.62"/>
        </filter>
        <filter id="softShadow" x="-40%" y="-40%" width="190%" height="210%">
          <feDropShadow dx="0" dy="10" stdDeviation="15"
                        flood-color="#000000" flood-opacity="0.44"/>
        </filter>
        <linearGradient id="darkFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#04111d" stop-opacity="0.96"/>
          <stop offset="23%" stop-color="#061725" stop-opacity="0.48"/>
          <stop offset="69%" stop-color="#061725" stop-opacity="0.38"/>
          <stop offset="100%" stop-color="#04111d" stop-opacity="0.98"/>
        </linearGradient>
        <linearGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#061725" stop-opacity="0"/>
          <stop offset="100%" stop-color="#061725" stop-opacity="0.98"/>
        </linearGradient>
        <linearGradient id="campaignGradient" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#f1a640"/>
          <stop offset="36%" stop-color="#dfb85f"/>
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
const logoMask = svg(
  '<circle cx="50" cy="50" r="48" fill="#ffffff"/>',
  100,
  100,
);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 100, height: 100, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();
const qrBuffer = await sharp(qrPath)
  .resize({ width: 390, height: 390, fit: "contain" })
  .png()
  .toBuffer();

const photoDefinitions = [
  {
    key: "hospitality",
    source: "hospitality.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    position: "centre",
    brightness: 1.08,
  },
  {
    key: "praise",
    source: "praise-worship-v2.jpg",
    crop: { left: 0, top: 0, width: 1280, height: 718 },
    position: "centre",
    brightness: 1.06,
  },
  {
    key: "ushers",
    source: "ushers.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    position: "north",
    brightness: 1.1,
  },
  {
    key: "security",
    source: "security.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    position: "centre",
    brightness: 1.32,
  },
  {
    key: "worshipWide",
    source: "worship-team-wide.jpeg",
    position: "centre",
    brightness: 1.04,
  },
  {
    key: "congregationWide",
    source: "congregation-worship-wide.jpeg",
    position: "centre",
    brightness: 1.06,
  },
  {
    key: "childrenMinistry",
    source: "children-ministry.jpeg",
    position: "centre",
    brightness: 1.03,
  },
  {
    key: "churchFellowship",
    source: "church-fellowship.jpeg",
    position: "centre",
    brightness: 1.02,
  },
];

const photos = {};
const photoPositions = {};
for (const definition of photoDefinitions) {
  let pipeline = sharp(path.join(sourceDir, definition.source));
  if (definition.crop) pipeline = pipeline.extract(definition.crop);
  photos[definition.key] = await pipeline
    .modulate({
      brightness: definition.brightness,
      saturation: 0.98,
    })
    .sharpen({ sigma: 0.85 })
    .png()
    .toBuffer();
  photoPositions[definition.key] = definition.position;
}

const narrative = [
  {
    slug: "growth",
    eyebrow: "THE WORK OF GOD",
    lines: ["THE WORK IS", "GROWING."],
    accentLine: "MORE HEARTS. MORE HANDS.",
    photos: ["congregationWide", "worshipWide", "churchFellowship", "praise"],
  },
  {
    slug: "willing-hearts",
    eyebrow: "SERVICE LOOKS LIKE",
    lines: ["SHOWING UP", "WITH A WILLING HEART."],
    accentLine: "YOUR SERVICE MATTERS.",
    photos: ["churchFellowship", "hospitality", "childrenMinistry", "ushers"],
  },
  {
    slug: "saved-to-serve",
    eyebrow: "THIS IS WHAT WE BELIEVE",
    lines: ["WE ARE", "SAVED TO SERVE."],
    accentLine: "“NOT TO BE SERVED, BUT TO SERVE.” — MARK 10:45",
    photos: ["worshipWide", "praise", "congregationWide", "security"],
  },
  {
    slug: "everyone",
    eyebrow: "AT RENEWED LIFE INTERNATIONAL",
    lines: ["THERE IS A PLACE", "FOR EVERYONE."],
    accentLine: "HOSPITALITY • WORSHIP • USHERS • SECURITY • MORE",
    photos: ["hospitality", "worshipWide", "childrenMinistry", "security"],
  },
  {
    slug: "question",
    eyebrow: "YOUR NEXT STEP",
    lines: ["THE GIFT?", "THE HEART?", "THE WILLINGNESS?"],
    accentLine: "GOD CAN USE A WILLING HEART.",
    photos: ["praise", "childrenMinistry", "ushers", "churchFellowship"],
  },
];

const variations = [
  {
    id: "01-documentary-warmth",
    name: "Documentary Warmth",
    layout: "documentary",
    accent: "#f1a640",
    soft: "#ffd99a",
    transitions: ["fade", "fade", "smoothleft", "fade", "fade"],
  },
  {
    id: "02-kinetic-split-screen",
    name: "Kinetic Split Screen",
    layout: "split",
    accent: "#5ec8ff",
    soft: "#c3edff",
    transitions: ["slideleft", "smoothright", "slideleft", "smoothleft", "fade"],
  },
  {
    id: "03-community-mosaic",
    name: "Community Mosaic",
    layout: "mosaic",
    accent: "#a979ff",
    soft: "#e0ccff",
    transitions: ["smoothleft", "smoothup", "smoothright", "smoothdown", "fade"],
  },
  {
    id: "04-scripture-led",
    name: "Scripture Led",
    layout: "scripture",
    accent: "#dfb85f",
    soft: "#f5e0a6",
    transitions: ["fadeblack", "fade", "fadeblack", "fade", "fadeblack"],
  },
  {
    id: "05-bold-impact",
    name: "Bold Impact",
    layout: "bold",
    accent: "#ff7a45",
    soft: "#ffd0be",
    transitions: ["slideleft", "slideup", "slideright", "slidedown", "fade"],
  },
];

const resizePhoto = async (
  key,
  photoWidth,
  photoHeight,
  radius = 0,
) => {
  const image = await sharp(photos[key])
    .resize(photoWidth, photoHeight, {
      fit: "cover",
      position: photoPositions[key],
    })
    .png()
    .toBuffer();
  if (radius === 0) return image;
  const mask = svg(
    `<rect width="${photoWidth}" height="${photoHeight}" rx="${radius}" fill="#ffffff"/>`,
    photoWidth,
    photoHeight,
  );
  return sharp(image)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
};

const makeBackdrop = async (key, accent, brightness = 0.48) => {
  const image = await sharp(photos[key])
    .resize(width, height, {
      fit: "cover",
      position: photoPositions[key],
    })
    .blur(42)
    .modulate({ brightness, saturation: 0.82 })
    .png()
    .toBuffer();
  const tint = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.42"/>
    <circle cx="930" cy="190" r="305" fill="${accent}" opacity="0.10"/>
    <circle cx="955" cy="220" r="205" fill="none"
            stroke="${accent}" stroke-width="2.5" opacity="0.26"/>
  `);
  return sharp(image)
    .composite([{ input: tint, left: 0, top: 0 }])
    .png()
    .toBuffer();
};

const headlineMarkup = (scene, variation, options = {}) => {
  const startY = options.startY ?? 225;
  const fontSize = options.fontSize ?? (scene.lines.length === 3 ? 67 : 78);
  const lineGap = options.lineGap ?? 94;
  const lineElements = scene.lines
    .map(
      (line, index) => `
        <text x="${options.x ?? 66}" y="${startY + index * lineGap}"
              fill="${index === scene.lines.length - 1 ? variation.accent : "#ffffff"}"
              font-family="${variation.layout === "scripture" ? "Georgia, Times New Roman, serif" : "Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"}"
              font-size="${fontSize}"
              font-style="${variation.layout === "scripture" && index === scene.lines.length - 1 ? "italic" : "normal"}"
              font-weight="900" letter-spacing="-1">
          ${escapeXml(line)}
        </text>
      `,
    )
    .join("");
  return `
    <text x="${options.x ?? 66}" y="${options.eyebrowY ?? 112}"
          fill="${variation.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="900" letter-spacing="4">
      ${escapeXml(scene.eyebrow)}
    </text>
    ${lineElements}
  `;
};

const footerMarkup = (variation) => `
  <line x1="66" y1="1792" x2="1014" y2="1792"
        stroke="${variation.accent}" stroke-width="2" opacity="0.75"/>
  <text x="66" y="1854" fill="${variation.soft}"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="20" font-weight="900" letter-spacing="3">
    BELIEVE • BELONG • BECOME
  </text>
  <text x="1014" y="1854" text-anchor="end" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="800" letter-spacing="2.2">
    RENEWED LIFE INTERNATIONAL
  </text>
`;

const renderDocumentary = async (scene, variation) => {
  const background = await makeBackdrop(scene.photos[0], variation.accent);
  const hero = await resizePhoto(scene.photos[0], 1080, 1320);
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="url(#darkFade)"/>
    <rect x="0" y="0" width="14" height="${height}" fill="${variation.accent}"/>
    ${headlineMarkup(scene, variation)}
    <rect x="66" y="${scene.lines.length === 3 ? 520 : 425}" width="230"
          height="7" rx="3.5" fill="${variation.accent}"/>
    <rect x="0" y="1420" width="${width}" height="500"
          fill="url(#bottomFade)"/>
    <text x="66" y="1665" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="900" letter-spacing="1.2">
      ${escapeXml(scene.accentLine)}
    </text>
    <text x="66" y="1720" fill="${variation.soft}"
          font-family="Georgia, Times New Roman, serif"
          font-size="24" font-style="italic" font-weight="700">
      Real people. Real service. Greater impact.
    </text>
    ${footerMarkup(variation)}
  `);
  return { background, composites: [
    { input: hero, left: 0, top: 455 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ] };
};

const renderSplit = async (scene, variation) => {
  const background = await makeBackdrop(scene.photos[1], variation.accent);
  const left = await resizePhoto(scene.photos[0], 530, 1300);
  const right = await resizePhoto(scene.photos[1], 530, 1300);
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.30"/>
    <rect x="0" y="0" width="14" height="${height}" fill="${variation.accent}"/>
    <rect x="0" y="0" width="${width}" height="435"
          fill="#04111d" opacity="0.94"/>
    ${headlineMarkup(scene, variation, {
      startY: 220,
      fontSize: scene.lines.length === 3 ? 62 : 74,
      lineGap: 90,
    })}
    <rect x="540" y="435" width="6" height="1285"
          fill="${variation.accent}"/>
    <rect x="0" y="1395" width="${width}" height="525"
          fill="url(#bottomFade)"/>
    <rect x="66" y="1580" width="948" height="92" rx="18"
          fill="${variation.accent}" opacity="0.92"/>
    <text x="540" y="1639" text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="900" letter-spacing="1.5">
      ${escapeXml(scene.accentLine)}
    </text>
    ${footerMarkup(variation)}
  `);
  return { background, composites: [
    { input: left, left: 0, top: 430 },
    { input: right, left: 550, top: 430 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ] };
};

const renderMosaic = async (scene, variation) => {
  const background = await makeBackdrop(scene.photos[2], variation.accent);
  const tileWidth = 474;
  const tileHeight = 530;
  const tiles = await Promise.all(
    scene.photos.map((key) => resizePhoto(key, tileWidth, tileHeight, 26)),
  );
  const positions = [
    { left: 54, top: 450 },
    { left: 552, top: 450 },
    { left: 54, top: 1005 },
    { left: 552, top: 1005 },
  ];
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.33"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="url(#campaignGradient)"/>
    <rect x="0" y="0" width="${width}" height="415"
          fill="#04111d" opacity="0.94"/>
    ${headlineMarkup(scene, variation, {
      startY: 215,
      fontSize: scene.lines.length === 3 ? 58 : 70,
      lineGap: 84,
    })}
    <rect x="45" y="441" width="990" height="1105" rx="38"
          fill="none" stroke="${variation.soft}" stroke-width="2"
          opacity="0.55"/>
    <rect x="54" y="1575" width="972" height="96" rx="48"
          fill="url(#campaignGradient)" filter="url(#softShadow)"/>
    <text x="540" y="1637" text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="1.2">
      ${escapeXml(scene.accentLine)}
    </text>
    ${footerMarkup(variation)}
  `);
  return { background, composites: [
    ...tiles.map((input, index) => ({
      input,
      left: positions[index].left,
      top: positions[index].top,
    })),
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ] };
};

const renderScripture = async (scene, variation) => {
  const background = await makeBackdrop(scene.photos[0], variation.accent, 0.40);
  const hero = await resizePhoto(scene.photos[0], 900, 1030, 34);
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.50"/>
    <rect x="0" y="0" width="14" height="${height}" fill="${variation.accent}"/>
    ${headlineMarkup(scene, variation, {
      startY: 215,
      fontSize: scene.lines.length === 3 ? 59 : 68,
      lineGap: 82,
    })}
    <rect x="82" y="420" width="916" height="1046" rx="42"
          fill="${navy}" stroke="${variation.accent}" stroke-width="3"
          filter="url(#deepShadow)"/>
    <rect x="0" y="1320" width="${width}" height="600"
          fill="url(#bottomFade)"/>
    <text x="540" y="1548" text-anchor="middle" fill="${variation.soft}"
          font-family="Georgia, Times New Roman, serif"
          font-size="23" font-style="italic" font-weight="700">
      ${escapeXml(scene.accentLine)}
    </text>
    <text x="540" y="1618" text-anchor="middle" fill="#ffffff"
          font-family="Georgia, Times New Roman, serif"
          font-size="24" font-style="italic" font-weight="700">
      “For even the Son of Man did not come to be served,
    </text>
    <text x="540" y="1655" text-anchor="middle" fill="#ffffff"
          font-family="Georgia, Times New Roman, serif"
          font-size="24" font-style="italic" font-weight="700">
      but to serve…” — Mark 10:45
    </text>
    ${footerMarkup(variation)}
  `);
  return { background, composites: [
    { input: overlay, left: 0, top: 0 },
    { input: hero, left: 90, top: 428 },
    { input: logoBuffer, left: 915, top: 1740 },
  ] };
};

const renderBold = async (scene, variation) => {
  const background = await makeBackdrop(scene.photos[0], variation.accent, 0.52);
  const hero = await resizePhoto(scene.photos[0], 1080, 1920);
  const giantWord =
    scene.slug === "growth"
      ? "GROW"
      : scene.slug === "willing-hearts"
        ? "SERVE"
        : scene.slug === "saved-to-serve"
          ? "SAVED"
          : scene.slug === "everyone"
            ? "ALL"
            : "YES";
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.63"/>
    <rect x="0" y="0" width="20" height="${height}" fill="${variation.accent}"/>
    <text x="1040" y="760" text-anchor="end" fill="none"
          stroke="${variation.accent}" stroke-width="4" opacity="0.24"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="260" font-weight="900" letter-spacing="-6">
      ${giantWord}
    </text>
    <rect x="50" y="90" width="980" height="${scene.lines.length === 3 ? 520 : 430}"
          rx="30" fill="#04111d" opacity="0.84"
          stroke="${variation.accent}" stroke-width="3"/>
    ${headlineMarkup(scene, variation, {
      x: 82,
      eyebrowY: 145,
      startY: 260,
      fontSize: scene.lines.length === 3 ? 64 : 82,
      lineGap: 100,
    })}
    <rect x="50" y="1450" width="980" height="230" rx="34"
          fill="${variation.accent}" opacity="0.92"
          filter="url(#softShadow)"/>
    <text x="540" y="1550" text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="1">
      ${escapeXml(scene.accentLine)}
    </text>
    <text x="540" y="1610" text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="850" letter-spacing="2.3">
      SAVED TO SERVE • MARK 10:45
    </text>
    ${footerMarkup(variation)}
  `);
  return { background, composites: [
    { input: hero, left: 0, top: 0 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ] };
};

const renderScene = async (scene, variation) => {
  if (variation.layout === "documentary")
    return renderDocumentary(scene, variation);
  if (variation.layout === "split") return renderSplit(scene, variation);
  if (variation.layout === "mosaic") return renderMosaic(scene, variation);
  if (variation.layout === "scripture")
    return renderScripture(scene, variation);
  return renderBold(scene, variation);
};

const renderCallToAction = async (variation) => {
  const background = await makeBackdrop(
    variation.layout === "documentary"
      ? "churchFellowship"
      : variation.layout === "split"
        ? "congregationWide"
        : variation.layout === "mosaic"
          ? "childrenMinistry"
          : variation.layout === "scripture"
            ? "worshipWide"
            : "security",
    variation.accent,
    0.35,
  );

  let decoration = "";
  if (variation.layout === "documentary") {
    decoration = `
      <rect x="66" y="115" width="948" height="250" rx="30"
            fill="#04111d" opacity="0.82"/>
      <text x="96" y="215" fill="#ffffff"
            font-family="Georgia, Times New Roman, serif"
            font-size="62" font-style="italic" font-weight="700">
        Take your next step.
      </text>
      <text x="96" y="285" fill="${variation.soft}"
            font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
            font-size="24" font-weight="850" letter-spacing="1.4">
        A WILLING HEART CAN MAKE A GREATER IMPACT.
      </text>
    `;
  } else if (variation.layout === "split") {
    decoration = `
      <rect x="0" y="0" width="430" height="${height}"
            fill="${variation.accent}" opacity="0.86"/>
      <text x="70" y="190" fill="${navy}"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="68" font-weight="900">
        TAKE
      </text>
      <text x="70" y="275" fill="${navy}"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="68" font-weight="900">
        YOUR
      </text>
      <text x="70" y="360" fill="${navy}"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="68" font-weight="900">
        NEXT
      </text>
      <text x="70" y="445" fill="${navy}"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="68" font-weight="900">
        STEP.
      </text>
    `;
  } else if (variation.layout === "mosaic") {
    decoration = `
      <circle cx="160" cy="230" r="145" fill="#f1a640" opacity="0.15"/>
      <circle cx="930" cy="260" r="170" fill="#5ec8ff" opacity="0.12"/>
      <text x="540" y="215" text-anchor="middle" fill="#ffffff"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="74" font-weight="900">
        TAKE YOUR NEXT STEP.
      </text>
      <text x="540" y="285" text-anchor="middle" fill="${variation.soft}"
            font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
            font-size="23" font-weight="850" letter-spacing="1.8">
        THERE IS A PLACE FOR YOU.
      </text>
    `;
  } else if (variation.layout === "scripture") {
    decoration = `
      <text x="540" y="150" text-anchor="middle" fill="${variation.soft}"
            font-family="Georgia, Times New Roman, serif"
            font-size="28" font-style="italic" font-weight="700">
        “Not to be served, but to serve.”
      </text>
      <text x="540" y="205" text-anchor="middle" fill="#ffffff"
            font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
            font-size="20" font-weight="900" letter-spacing="3">
        MARK 10:45
      </text>
      <text x="540" y="325" text-anchor="middle" fill="#ffffff"
            font-family="Georgia, Times New Roman, serif"
            font-size="66" font-style="italic" font-weight="700">
        Take your next step.
      </text>
    `;
  } else {
    decoration = `
      <text x="540" y="300" text-anchor="middle" fill="none"
            stroke="${variation.accent}" stroke-width="5" opacity="0.30"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="220" font-weight="900" letter-spacing="-4">
        SCAN
      </text>
      <text x="540" y="360" text-anchor="middle" fill="#ffffff"
            font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
            font-size="78" font-weight="900">
        TAKE YOUR NEXT STEP.
      </text>
    `;
  }

  const qrLeft = variation.layout === "split" ? 575 : 345;
  const qrTop = variation.layout === "split" ? 485 : 520;
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.82"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="${variation.layout === "mosaic" ? "url(#campaignGradient)" : variation.accent}"/>
    ${decoration}
    <rect x="${qrLeft - 40}" y="${qrTop - 40}" width="470" height="470"
          rx="48" fill="#ffffff" stroke="${variation.accent}"
          stroke-width="7" filter="url(#deepShadow)"/>
    <text x="${variation.layout === "split" ? 770 : 540}" y="1015"
          text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="39" font-weight="900" letter-spacing="1.3">
      SCAN TO REGISTER
    </text>
    <text x="${variation.layout === "split" ? 770 : 540}" y="1072"
          text-anchor="middle" fill="${variation.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="850" letter-spacing="1.2">
      OR TAP THE LINK IN THE CAPTION
    </text>
    <rect x="${variation.layout === "split" ? 485 : 145}" y="1205"
          width="${variation.layout === "split" ? 540 : 790}" height="100"
          rx="50"
          fill="${variation.layout === "mosaic" ? "url(#campaignGradient)" : variation.accent}"
          filter="url(#softShadow)"/>
    <text x="${variation.layout === "split" ? 755 : 540}" y="1272"
          text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="${variation.layout === "split" ? 26 : 31}"
          font-weight="900" letter-spacing="2">
      REGISTER • JOIN • SERVE
    </text>
    <text x="${variation.layout === "split" ? 755 : 540}" y="1415"
          text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="${variation.layout === "split" ? 18 : 23}"
          font-weight="800">
      HOSPITALITY • PRAISE &amp; WORSHIP • USHERS • SECURITY
    </text>
    <text x="${variation.layout === "split" ? 755 : 540}" y="1460"
          text-anchor="middle" fill="${variation.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="800">
      AND OTHER MINISTRY DEPARTMENTS
    </text>
    <text x="${variation.layout === "split" ? 755 : 540}" y="1635"
          text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="${variation.layout === "split" ? 24 : 30}"
          font-weight="900" letter-spacing="3">
      BELIEVE • BELONG • BECOME
    </text>
    <text x="${variation.layout === "split" ? 755 : 540}" y="1705"
          text-anchor="middle" fill="${variation.accent}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="3">
      #GREATERIMPACT
    </text>
  `);
  return {
    background,
    composites: [
      { input: overlay, left: 0, top: 0 },
      { input: qrBuffer, left: qrLeft, top: qrTop },
      {
        input: logoBuffer,
        left: variation.layout === "split" ? 705 : 490,
        top: 1785,
      },
    ],
  };
};

const encodeVideo = (variation, scenePaths, videoPath) => {
  const args = ["-y"];
  for (let index = 0; index < scenePaths.length; index += 1) {
    args.push(
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      String(durations[index]),
      "-i",
      scenePaths[index],
    );
  }

  const filterParts = [];
  for (let index = 0; index < scenePaths.length; index += 1) {
    const frames = Math.max(1, Math.ceil(durations[index] * 30) - 1);
    let zoom = "min(zoom+0.0003,1.045)";
    let x = "iw/2-(iw/zoom/2)";
    let y = "ih/2-(ih/zoom/2)";
    if (variation.layout === "split" || variation.layout === "bold") {
      zoom = "1.045";
      x =
        index % 2 === 0
          ? `(iw-iw/zoom)*on/${frames}`
          : `(iw-iw/zoom)*(1-on/${frames})`;
    } else if (variation.layout === "scripture") {
      zoom = "min(zoom+0.00015,1.025)";
    }
    if (index === scenePaths.length - 1) {
      zoom = "1.0";
      x = "0";
      y = "0";
    }
    filterParts.push(
      `[${index}:v]scale=1080:1920,zoompan=z='${zoom}':x='${x}':y='${y}':d=1:s=1080x1920:fps=30,trim=duration=${durations[index]},setpts=PTS-STARTPTS[v${index}]`,
    );
  }

  let previous = "v0";
  for (let index = 1; index < scenePaths.length; index += 1) {
    const output = index === scenePaths.length - 1 ? "vout" : `x${index}`;
    filterParts.push(
      `[${previous}][v${index}]xfade=transition=${variation.transitions[index - 1]}:duration=${transitionDuration}:offset=${offsets[index - 1]}[${output}]`,
    );
    previous = output;
  }

  args.push(
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-profile:v",
    "high",
    "-level",
    "4.1",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    "-movflags",
    "+faststart",
    videoPath,
  );

  const result = spawnSync("ffmpeg", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed for ${variation.name}:\n${result.stderr}`);
  }
};

const requestedVariationId = process.env.VARIATION_ID;
const variationsToRender = requestedVariationId
  ? variations.filter((variation) => variation.id === requestedVariationId)
  : variations;

if (requestedVariationId && variationsToRender.length === 0) {
  throw new Error(`Unknown variation: ${requestedVariationId}`);
}

for (const variation of variationsToRender) {
  const variationDir = path.join(outputDir, variation.id);
  await fs.mkdir(variationDir, { recursive: true });
  const scenePaths = [];

  for (let index = 0; index < narrative.length; index += 1) {
    const scene = narrative[index];
    const rendered = await renderScene(scene, variation);
    const scenePath = path.join(
      variationDir,
      `${String(index + 1).padStart(2, "0")}-${scene.slug}.png`,
    );
    await sharp(rendered.background)
      .composite(rendered.composites)
      .png({ quality: 100 })
      .toFile(scenePath);
    scenePaths.push(scenePath);
  }

  const callToAction = await renderCallToAction(variation);
  const callToActionPath = path.join(variationDir, "06-call-to-action.png");
  await sharp(callToAction.background)
    .composite(callToAction.composites)
    .png({ quality: 100 })
    .toFile(callToActionPath);
  scenePaths.push(callToActionPath);

  const videoPath = path.join(
    outputDir,
    `${variation.id}-saved-to-serve-tiktok-no-audio.mp4`,
  );
  encodeVideo(variation, scenePaths, videoPath);
  console.log(`Created ${videoPath}`);
}
