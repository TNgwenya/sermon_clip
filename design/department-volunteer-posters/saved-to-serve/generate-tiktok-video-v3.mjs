import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const projectRoot = path.resolve(campaignDir, "../../..");
const sourceDir = path.join(campaignDir, "sources");
const outputDir = path.join(campaignDir, "beautiful");
const sceneDir = path.join(outputDir, "tiktok-v3-scenes");
const outputPath = path.join(
  outputDir,
  "saved-to-serve-volunteers-tiktok-v3-no-audio.mp4",
);
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
const cream = "#ffd99a";

await fs.mkdir(sceneDir, { recursive: true });

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
          <feDropShadow dx="0" dy="24" stdDeviation="30"
                        flood-color="#000000" flood-opacity="0.62"/>
        </filter>
        <filter id="softShadow" x="-40%" y="-40%" width="190%" height="210%">
          <feDropShadow dx="0" dy="10" stdDeviation="16"
                        flood-color="#000000" flood-opacity="0.42"/>
        </filter>
        <linearGradient id="navyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#04111d" stop-opacity="0.96"/>
          <stop offset="23%" stop-color="#061725" stop-opacity="0.42"/>
          <stop offset="68%" stop-color="#061725" stop-opacity="0.36"/>
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

const departments = [
  {
    key: "hospitality",
    source: "hospitality.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#f1a640",
    soft: "#ffd99a",
    name: "HOSPITALITY",
    line: "HELP SOMEONE FEEL AT HOME.",
    position: "centre",
    brightness: 1.08,
  },
  {
    key: "praise",
    source: "praise-worship-v2.jpg",
    crop: { left: 0, top: 0, width: 1280, height: 718 },
    accent: "#a979ff",
    soft: "#e0ccff",
    name: "PRAISE & WORSHIP",
    line: "USE YOUR GIFT TO LEAD.",
    position: "centre",
    brightness: 1.06,
  },
  {
    key: "ushers",
    source: "ushers.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#dfb85f",
    soft: "#f5e0a6",
    name: "USHERS",
    line: "SERVE WITH CARE AND EXCELLENCE.",
    position: "north",
    brightness: 1.1,
  },
  {
    key: "security",
    source: "security.jpg",
    crop: { left: 0, top: 442, width: 591, height: 397 },
    accent: "#5ec8ff",
    soft: "#c3edff",
    name: "SECURITY",
    line: "HELP CREATE A SAFE CHURCH HOME.",
    position: "centre",
    brightness: 1.32,
  },
];

const churchLife = [
  {
    key: "worshipWide",
    source: "worship-team-wide.jpeg",
    accent: "#a979ff",
    soft: "#e0ccff",
    name: "WORSHIP",
    position: "centre",
    brightness: 1.04,
  },
  {
    key: "congregationWide",
    source: "congregation-worship-wide.jpeg",
    accent: "#5ec8ff",
    soft: "#c3edff",
    name: "COMMUNITY",
    position: "centre",
    brightness: 1.06,
  },
  {
    key: "childrenMinistry",
    source: "children-ministry.jpeg",
    accent: "#f1a640",
    soft: "#ffd99a",
    name: "CHILDREN’S MINISTRY",
    position: "centre",
    brightness: 1.03,
  },
  {
    key: "churchFellowship",
    source: "church-fellowship.jpeg",
    accent: "#dfb85f",
    soft: "#f5e0a6",
    name: "FELLOWSHIP",
    position: "centre",
    brightness: 1.02,
  },
];

const sourceBuffers = {};
for (const department of departments) {
  sourceBuffers[department.key] = await sharp(
    path.join(sourceDir, department.source),
  )
    .extract(department.crop)
    .modulate({
      brightness: department.brightness,
      saturation: 0.98,
    })
    .sharpen({ sigma: 0.95 })
    .png()
    .toBuffer();
}
for (const moment of churchLife) {
  sourceBuffers[moment.key] = await sharp(
    path.join(sourceDir, moment.source),
  )
    .modulate({
      brightness: moment.brightness,
      saturation: 0.98,
    })
    .sharpen({ sigma: 0.82 })
    .png()
    .toBuffer();
}

const makeBackground = async (source, accent) => {
  const blurred = await sharp(source)
    .resize(width, height, { fit: "cover", position: "centre" })
    .blur(42)
    .modulate({ brightness: 0.48, saturation: 0.82 })
    .png()
    .toBuffer();
  const tint = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.40"/>
    <circle cx="925" cy="190" r="300" fill="${accent}" opacity="0.11"/>
    <circle cx="955" cy="220" r="205" fill="none"
            stroke="${accent}" stroke-width="2.5" opacity="0.28"/>
  `);
  return sharp(blurred)
    .composite([{ input: tint, left: 0, top: 0 }])
    .png()
    .toBuffer();
};

const makeHero = async (
  source,
  heroWidth,
  heroHeight,
  position = "centre",
  radius = 0,
) => {
  const resized = await sharp(source)
    .resize(heroWidth, heroHeight, { fit: "cover", position })
    .png()
    .toBuffer();
  if (radius === 0) return resized;
  const mask = svg(
    `<rect width="${heroWidth}" height="${heroHeight}" rx="${radius}" fill="#ffffff"/>`,
    heroWidth,
    heroHeight,
  );
  return sharp(resized)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
};

const brandFooter = (accent, soft) => `
  <line x1="66" y1="1790" x2="1014" y2="1790"
        stroke="${accent}" stroke-width="2" opacity="0.72"/>
  <text x="66" y="1852" fill="${soft}"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="21" font-weight="900" letter-spacing="3">
    BELIEVE • BELONG • BECOME
  </text>
  <text x="1014" y="1852" text-anchor="end" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="18" font-weight="800" letter-spacing="2.2">
    RENEWED LIFE INTERNATIONAL
  </text>
`;

const writeScene = async (filename, background, composites) => {
  await sharp(background)
    .composite(composites)
    .png({ quality: 100 })
    .toFile(path.join(sceneDir, filename));
};

// Scene 1 — Growth.
{
  const department = departments[1];
  const background = await makeBackground(
    sourceBuffers.congregationWide,
    department.accent,
  );
  const hero = await makeHero(
    sourceBuffers.congregationWide,
    1080,
    1210,
    "centre",
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="url(#navyFade)"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="${department.accent}"/>
    <text x="66" y="112" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="4.2">
      RENEWED LIFE INTERNATIONAL
    </text>
    <text x="66" y="244" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="71" font-weight="900" letter-spacing="-1">
      THE WORK OF GOD
    </text>
    <text x="66" y="347" fill="${department.accent}"
          font-family="Georgia, Times New Roman, serif"
          font-size="89" font-style="italic" font-weight="700">
      is growing.
    </text>
    <rect x="66" y="392" width="240" height="7" rx="3.5"
          fill="${department.accent}"/>
    <rect x="0" y="1420" width="${width}" height="500"
          fill="url(#bottomFade)"/>
    <text x="66" y="1640" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="2">
      SAVED TO SERVE
    </text>
    <text x="66" y="1693" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="750" letter-spacing="1.5">
      “NOT TO BE SERVED, BUT TO SERVE.” — MARK 10:45
    </text>
    ${brandFooter(department.accent, department.soft)}
  `);
  await writeScene("01-growth.png", background, [
    { input: hero, left: 0, top: 420 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ]);
}

// Scene 2 — Hearts and hands.
{
  const department = departments[0];
  const background = await makeBackground(
    sourceBuffers.churchFellowship,
    department.accent,
  );
  const hero = await makeHero(
    sourceBuffers.churchFellowship,
    1080,
    1250,
    "centre",
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="url(#navyFade)"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="${department.accent}"/>
    <text x="66" y="120" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="4">
      AS THE MINISTRY GROWS
    </text>
    <text x="66" y="258" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="84" font-weight="900" letter-spacing="-1">
      MORE HEARTS.
    </text>
    <text x="66" y="360" fill="${department.accent}"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="84" font-weight="900" letter-spacing="-1">
      MORE HANDS.
    </text>
    <rect x="66" y="406" width="230" height="7" rx="3.5"
          fill="${department.accent}"/>
    <rect x="0" y="1405" width="${width}" height="515"
          fill="url(#bottomFade)"/>
    <text x="66" y="1645" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="29" font-weight="850">
      EVERY ACT OF SERVICE HELPS SOMEONE
    </text>
    <text x="66" y="1690" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="29" font-weight="850">
      FEEL SEEN, VALUED AND AT HOME.
    </text>
    ${brandFooter(department.accent, department.soft)}
  `);
  await writeScene("02-hearts-hands.png", background, [
    { input: hero, left: 0, top: 425 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ]);
}

// Scene 3 — Saved to serve in a moving-photo-strip composition.
{
  const background = await makeBackground(
    sourceBuffers.security,
    "#a979ff",
  );
  const stripWidth = 270;
  const strips = await Promise.all(
    churchLife.map((moment) =>
      makeHero(
        sourceBuffers[moment.key],
        stripWidth,
        1250,
        moment.position,
      ),
    ),
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.38"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="url(#campaignGradient)"/>
    <rect x="0" y="0" width="${width}" height="430"
          fill="#04111d" opacity="0.88"/>
    <rect x="0" y="1380" width="${width}" height="540"
          fill="url(#bottomFade)"/>
    <text x="66" y="126" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="4.5">
      THIS IS WHAT WE BELIEVE
    </text>
    <text x="66" y="255" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="92" font-weight="900" letter-spacing="-1.5">
      WE ARE
    </text>
    <text x="66" y="370" fill="url(#campaignGradient)"
          font-family="Georgia, Times New Roman, serif"
          font-size="94" font-style="italic" font-weight="700">
      saved to serve.
    </text>
    <rect x="55" y="462" width="970" height="1215" rx="42"
          fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.56"/>
    <rect x="0" y="1390" width="${width}" height="530"
          fill="url(#bottomFade)"/>
    <text x="66" y="1655" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="2">
      YOUR SERVICE MATTERS.
    </text>
    <text x="66" y="1702" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="800" letter-spacing="1.5">
      THERE IS PURPOSE IN EVERY WILLING HEART.
    </text>
    ${brandFooter("#f1a640", cream)}
  `);
  await writeScene("03-saved-to-serve.png", background, [
    ...strips.map((input, index) => ({
      input,
      left: index * stripWidth,
      top: 455,
    })),
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ]);
}

// Scene 4 — Everyone / all departments.
{
  const background = await makeBackground(
    sourceBuffers.hospitality,
    "#5ec8ff",
  );
  const tileWidth = 472;
  const tileHeight = 555;
  const positions = [
    { left: 55, top: 440 },
    { left: 553, top: 440 },
    { left: 55, top: 1020 },
    { left: 553, top: 1020 },
  ];
  const tiles = await Promise.all(
    churchLife.map(async (department) => {
      const photo = await makeHero(
        sourceBuffers[department.key],
        tileWidth,
        tileHeight,
        department.position,
        28,
      );
      const label = svg(
        `
          <defs>
            <linearGradient id="tileFade" x1="0" y1="0" x2="0" y2="1">
              <stop offset="45%" stop-color="#061725" stop-opacity="0"/>
              <stop offset="100%" stop-color="#061725" stop-opacity="0.94"/>
            </linearGradient>
          </defs>
          <rect width="${tileWidth}" height="${tileHeight}" rx="28"
                fill="url(#tileFade)"/>
          <rect x="26" y="475" width="80" height="6" rx="3"
                fill="${department.accent}"/>
          <text x="26" y="523" fill="#ffffff"
                font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
                font-size="23" font-weight="900" letter-spacing="1.6">
            ${escapeXml(department.name)}
          </text>
        `,
        tileWidth,
        tileHeight,
      );
      return sharp(photo)
        .composite([{ input: label, left: 0, top: 0 }])
        .png()
        .toBuffer();
    }),
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.30"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="url(#campaignGradient)"/>
    <rect x="0" y="0" width="${width}" height="390"
          fill="#04111d" opacity="0.92"/>
    <text x="66" y="118" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="4">
      AT RENEWED LIFE INTERNATIONAL
    </text>
    <text x="66" y="243" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="74" font-weight="900" letter-spacing="-1">
      THERE IS A PLACE
    </text>
    <text x="66" y="340" fill="url(#campaignGradient)"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="78" font-weight="900" letter-spacing="-1">
      FOR EVERYONE.
    </text>
    <rect x="48" y="432" width="984" height="1155" rx="42"
          fill="none" stroke="#ffffff" stroke-width="2.5" opacity="0.45"/>
    ${brandFooter("#5ec8ff", "#c3edff")}
  `);
  await writeScene("04-everyone.png", background, [
    ...tiles.map((input, index) => ({
      input,
      left: positions[index].left,
      top: positions[index].top,
    })),
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ]);
}

// Scenes 5–8 — Fast full-screen department moments.
for (let index = 0; index < departments.length; index += 1) {
  const department = departments[index];
  const departmentSource =
    department.key === "praise"
      ? sourceBuffers.worshipWide
      : sourceBuffers[department.key];
  const background = await makeBackground(
    departmentSource,
    department.accent,
  );
  const hero = await makeHero(
    departmentSource,
    1080,
    1480,
    department.position,
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="url(#navyFade)"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="${department.accent}"/>
    <text x="66" y="120" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="900" letter-spacing="4">
      JOIN THE TEAM
    </text>
    <rect x="0" y="1300" width="${width}" height="620"
          fill="url(#bottomFade)"/>
    <text x="66" y="1484" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="${department.key === "praise" ? 62 : 78}"
          font-weight="900" letter-spacing="-0.8">
      ${escapeXml(department.name)}
    </text>
    <rect x="66" y="1528" width="130" height="7" rx="3.5"
          fill="${department.accent}"/>
    <text x="66" y="1608" fill="${department.soft}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="850">
      ${escapeXml(department.line)}
    </text>
    <text x="66" y="1690" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="2.5">
      SAVED TO SERVE
    </text>
    ${brandFooter(department.accent, department.soft)}
  `);
  await writeScene(
    `${String(index + 5).padStart(2, "0")}-${department.key}.png`,
    background,
    [
      { input: hero, left: 0, top: 205 },
      { input: overlay, left: 0, top: 0 },
      { input: logoBuffer, left: 915, top: 1740 },
    ],
  );
}

// Scene 9 — Personal challenge.
{
  const background = await makeBackground(
    sourceBuffers.praise,
    "#a979ff",
  );
  const hero = await makeHero(
    sourceBuffers.praise,
    1080,
    820,
    "centre",
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.76"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="url(#campaignGradient)"/>
    <circle cx="880" cy="310" r="290" fill="#a979ff" opacity="0.10"/>
    <text x="66" y="140" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="4.5">
      YOUR NEXT STEP
    </text>
    <text x="66" y="278" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="74" font-weight="900" letter-spacing="-1">
      DO YOU HAVE
    </text>
    <text x="66" y="448" fill="#f1a640"
          font-family="Georgia, Times New Roman, serif"
          font-size="91" font-style="italic" font-weight="700">
      the gift?
    </text>
    <text x="66" y="600" fill="#a979ff"
          font-family="Georgia, Times New Roman, serif"
          font-size="91" font-style="italic" font-weight="700">
      the heart?
    </text>
    <text x="66" y="752" fill="#5ec8ff"
          font-family="Georgia, Times New Roman, serif"
          font-size="91" font-style="italic" font-weight="700">
      the willingness?
    </text>
    <rect x="0" y="1075" width="${width}" height="845"
          fill="url(#bottomFade)"/>
    <text x="66" y="1510" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="34" font-weight="900" letter-spacing="1.5">
      GOD CAN USE A WILLING HEART.
    </text>
    <text x="66" y="1570" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="750">
      TAKE YOUR NEXT STEP AND JOIN A MINISTRY TEAM.
    </text>
    ${brandFooter("#a979ff", "#e0ccff")}
  `);
  await writeScene("09-question.png", background, [
    { input: hero, left: 0, top: 850 },
    { input: overlay, left: 0, top: 0 },
    { input: logoBuffer, left: 915, top: 1740 },
  ]);
}

// Scene 10 — Stationary scan / register end card.
{
  const background = await makeBackground(
    sourceBuffers.security,
    "#5ec8ff",
  );
  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="#04111d" opacity="0.87"/>
    <rect x="0" y="0" width="14" height="${height}"
          fill="url(#campaignGradient)"/>
    <circle cx="540" cy="720" r="430" fill="#a979ff" opacity="0.10"/>
    <circle cx="540" cy="720" r="330" fill="#5ec8ff" opacity="0.09"/>
    <text x="540" y="150" text-anchor="middle" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="5">
      SAVED TO SERVE
    </text>
    <text x="540" y="278" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="78" font-weight="900" letter-spacing="-1">
      TAKE YOUR
    </text>
    <text x="540" y="372" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="78" font-weight="900" letter-spacing="-1">
      NEXT STEP.
    </text>
    <rect x="305" y="480" width="470" height="470" rx="46"
          fill="#ffffff" stroke="#f1a640" stroke-width="7"
          filter="url(#deepShadow)"/>
    <text x="540" y="1040" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="42" font-weight="900" letter-spacing="1.5">
      SCAN TO REGISTER
    </text>
    <text x="540" y="1098" text-anchor="middle" fill="#c3edff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="800" letter-spacing="1.3">
      OR TAP THE LINK IN THE CAPTION
    </text>
    <rect x="145" y="1225" width="790" height="100" rx="50"
          fill="url(#campaignGradient)" filter="url(#softShadow)"/>
    <text x="540" y="1292" text-anchor="middle" fill="${navy}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="31" font-weight="900" letter-spacing="2">
      REGISTER • JOIN • SERVE
    </text>
    <text x="540" y="1435" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="750">
      HOSPITALITY • PRAISE &amp; WORSHIP • USHERS • SECURITY
    </text>
    <text x="540" y="1483" text-anchor="middle" fill="${cream}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="750">
      AND OTHER MINISTRY DEPARTMENTS
    </text>
    <text x="540" y="1650" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="31" font-weight="900" letter-spacing="4">
      BELIEVE • BELONG • BECOME
    </text>
    <text x="540" y="1720" text-anchor="middle" fill="#a979ff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="3">
      #GREATERIMPACT
    </text>
  `);
  await writeScene("10-call-to-action.png", background, [
    { input: overlay, left: 0, top: 0 },
    { input: qrBuffer, left: 345, top: 520 },
    { input: logoBuffer, left: 490, top: 1790 },
  ]);
}

const sceneFiles = [
  "01-growth.png",
  "02-hearts-hands.png",
  "03-saved-to-serve.png",
  "04-everyone.png",
  "05-hospitality.png",
  "06-praise.png",
  "07-ushers.png",
  "08-security.png",
  "09-question.png",
  "10-call-to-action.png",
];
const scenePaths = sceneFiles.map((filename) =>
  path.join(sceneDir, filename),
);
const durations = [3.6, 3.6, 3.4, 3.5, 1.9, 1.9, 1.9, 1.9, 4.0, 6.7];
const transitionDuration = 0.45;
const offsets = [3.15, 6.3, 9.25, 12.3, 13.75, 15.2, 16.65, 18.1, 21.65];
const transitions = [
  "fade",
  "smoothleft",
  "fade",
  "slideleft",
  "fade",
  "slideleft",
  "fade",
  "smoothup",
  "fade",
];

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
  let zoom = "min(zoom+0.00028,1.045)";
  let x = "iw/2-(iw/zoom/2)";
  let y = "ih/2-(ih/zoom/2)";
  if (index % 3 === 1) {
    zoom = "1.045";
    x = `(iw-iw/zoom)*on/${frames}`;
  } else if (index % 3 === 2) {
    zoom = "1.045";
    x = `(iw-iw/zoom)*(1-on/${frames})`;
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
    `[${previous}][v${index}]xfade=transition=${transitions[index - 1]}:duration=${transitionDuration}:offset=${offsets[index - 1]}[${output}]`,
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
  outputPath,
);

const result = spawnSync("ffmpeg", args, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  throw new Error(`ffmpeg failed:\n${result.stderr}`);
}

console.log(`Created ${outputPath}`);
