import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const beautifulDir = path.join(campaignDir, "beautiful");
const sceneDir = path.join(beautifulDir, "tiktok-scenes");
const outputPath = path.join(
  beautifulDir,
  "saved-to-serve-volunteers-tiktok-no-audio.mp4",
);
const projectRoot = path.resolve(campaignDir, "../../..");
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
const posterWidth = 956;
const posterHeight = 1195;
const posterLeft = 62;
const posterTop = 312;

await fs.mkdir(sceneDir, { recursive: true });

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
        <filter id="shadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="24" stdDeviation="28"
                        flood-color="#000000" flood-opacity="0.62"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="170%" height="190%">
          <feDropShadow dx="0" dy="10" stdDeviation="16"
                        flood-color="#000000" flood-opacity="0.42"/>
        </filter>
        <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#04101b" stop-opacity="0.82"/>
          <stop offset="23%" stop-color="#061725" stop-opacity="0.56"/>
          <stop offset="78%" stop-color="#061725" stop-opacity="0.58"/>
          <stop offset="100%" stop-color="#04101b" stop-opacity="0.94"/>
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
  <svg width="92" height="92" viewBox="0 0 92 92"
       xmlns="http://www.w3.org/2000/svg">
    <circle cx="46" cy="46" r="44" fill="#ffffff"/>
  </svg>
`);
const logoBuffer = await sharp(trimmedLogo)
  .resize({ width: 92, height: 92, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();
const qrBuffer = await sharp(qrPath)
  .resize({ width: 380, height: 380, fit: "contain" })
  .png()
  .toBuffer();

const posterMask = Buffer.from(`
  <svg width="${posterWidth}" height="${posterHeight}"
       viewBox="0 0 ${posterWidth} ${posterHeight}"
       xmlns="http://www.w3.org/2000/svg">
    <rect width="${posterWidth}" height="${posterHeight}" rx="34" fill="#ffffff"/>
  </svg>
`);

const scenes = [
  {
    filename: "01-all-teams.png",
    poster: "volunteers-needed-saved-to-serve.png",
    accent: "#f1a640",
    accent2: "#5ec8ff",
    eyebrow: "THE WORK IS GROWING",
    headline: "MORE HEARTS. MORE HANDS.",
    footer: "VOLUNTEERS NEEDED • SAVED TO SERVE",
  },
  {
    filename: "02-hospitality.png",
    poster: "hospitality-saved-to-serve.png",
    accent: "#f1a640",
    accent2: "#ffd99a",
    eyebrow: "HOSPITALITY",
    headline: "HELP SOMEONE FEEL AT HOME.",
    footer: "WELCOME • CARE • CONNECT",
  },
  {
    filename: "03-praise-worship.png",
    poster: "praise-worship-saved-to-serve.png",
    accent: "#a979ff",
    accent2: "#e0ccff",
    eyebrow: "PRAISE & WORSHIP",
    headline: "USE YOUR GIFT TO LEAD.",
    footer: "WORSHIP • SERVE • GLORIFY",
  },
  {
    filename: "04-ushers.png",
    poster: "ushers-saved-to-serve.png",
    accent: "#dfb85f",
    accent2: "#f5e0a6",
    eyebrow: "USHERS",
    headline: "SERVE WITH CARE AND EXCELLENCE.",
    footer: "ORDER • CARE • EXCELLENCE",
  },
  {
    filename: "05-security.png",
    poster: "security-saved-to-serve.png",
    accent: "#5ec8ff",
    accent2: "#c3edff",
    eyebrow: "SECURITY",
    headline: "HELP CREATE A SAFE CHURCH HOME.",
    footer: "WATCHFUL • READY • PRESENT",
  },
];

const buildPosterScene = async (scene) => {
  const sourcePath = path.join(beautifulDir, scene.poster);
  const background = await sharp(sourcePath)
    .resize(width, height, { fit: "cover", position: "centre" })
    .blur(42)
    .modulate({ brightness: 0.56, saturation: 0.88 })
    .png()
    .toBuffer();

  const poster = await sharp(sourcePath)
    .resize(posterWidth, posterHeight, { fit: "fill" })
    .composite([{ input: posterMask, blend: "dest-in" }])
    .png()
    .toBuffer();

  const overlay = svg(`
    <rect width="${width}" height="${height}" fill="url(#shade)"/>
    <circle cx="936" cy="174" r="260" fill="${scene.accent}" opacity="0.12"/>
    <circle cx="952" cy="184" r="170" fill="none"
            stroke="${scene.accent2}" stroke-width="2" opacity="0.24"/>
    <rect x="0" y="0" width="13" height="${height}" fill="${scene.accent}"/>

    <text x="65" y="102" fill="${scene.accent2}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="900" letter-spacing="4">
      ${escapeXml(scene.eyebrow)}
    </text>
    <text x="65" y="175" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="52" font-weight="900" letter-spacing="-0.5">
      ${escapeXml(scene.headline)}
    </text>
    <line x1="65" y1="218" x2="1015" y2="218"
          stroke="${scene.accent}" stroke-width="3"/>

    <rect x="${posterLeft - 8}" y="${posterTop - 8}"
          width="${posterWidth + 16}" height="${posterHeight + 16}"
          rx="42" fill="#061725" stroke="${scene.accent}" stroke-width="4"
          filter="url(#shadow)"/>

    <rect x="62" y="1570" width="956" height="220" rx="42"
          fill="#061725" opacity="0.96" stroke="${scene.accent}"
          stroke-width="2.5" filter="url(#softShadow)"/>
    <rect x="96" y="1605" width="104" height="7" rx="3.5"
          fill="${scene.accent}"/>
    <text x="96" y="1672" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="34" font-weight="900" letter-spacing="1">
      SAVED TO SERVE.
    </text>
    <text x="96" y="1723" fill="${scene.accent2}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="800" letter-spacing="2.2">
      ${escapeXml(scene.footer)}
    </text>
    <text x="96" y="1767" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="20" font-weight="700" letter-spacing="1.3">
      BELIEVE • BELONG • BECOME
    </text>

    <text x="1015" y="1865" text-anchor="end" fill="${scene.accent2}"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="20" font-weight="900" letter-spacing="2.5">
      RENEWED LIFE INTERNATIONAL
    </text>
  `);

  await sharp(background)
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: poster, left: posterLeft, top: posterTop },
      { input: logoBuffer, left: 65, top: 1805 },
    ])
    .png({ quality: 100 })
    .toFile(path.join(sceneDir, scene.filename));
};

await Promise.all(scenes.map(buildPosterScene));

const endPosterPath = path.join(
  beautifulDir,
  "volunteers-needed-saved-to-serve.png",
);
const endBackground = await sharp(endPosterPath)
  .resize(width, height, { fit: "cover", position: "centre" })
  .blur(44)
  .modulate({ brightness: 0.44, saturation: 0.84 })
  .png()
  .toBuffer();

const endOverlay = svg(`
  <rect width="${width}" height="${height}" fill="#04111d" opacity="0.78"/>
  <circle cx="540" cy="725" r="430" fill="#a979ff" opacity="0.10"/>
  <circle cx="540" cy="725" r="330" fill="#5ec8ff" opacity="0.08"/>
  <rect x="0" y="0" width="13" height="${height}" fill="#f1a640"/>

  <text x="540" y="182" text-anchor="middle" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="24" font-weight="900" letter-spacing="5">
    SAVED TO SERVE
  </text>
  <text x="540" y="300" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
        font-size="78" font-weight="900" letter-spacing="-1">
    THERE IS A PLACE
  </text>
  <text x="540" y="392" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
        font-size="78" font-weight="900" letter-spacing="-1">
    FOR YOU TO SERVE.
  </text>

  <rect x="315" y="500" width="450" height="450" rx="44"
        fill="#ffffff" stroke="#f1a640" stroke-width="6"
        filter="url(#shadow)"/>

  <text x="540" y="1035" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="42" font-weight="900" letter-spacing="1.5">
    SCAN TO JOIN
  </text>
  <text x="540" y="1091" text-anchor="middle" fill="#c3edff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="25" font-weight="800" letter-spacing="1.3">
    OR TAP THE LINK IN THE CAPTION
  </text>

  <text x="540" y="1235" text-anchor="middle" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="22" font-weight="650">
    “For even the Son of Man did not come to be served,
  </text>
  <text x="540" y="1270" text-anchor="middle" fill="#ffd99a"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="22" font-weight="650">
    but to serve…” — Mark 10:45
  </text>

  <rect x="160" y="1395" width="760" height="96" rx="48"
        fill="#f1a640" filter="url(#softShadow)"/>
  <text x="540" y="1459" text-anchor="middle" fill="#061725"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="32" font-weight="900" letter-spacing="2">
    REGISTER • JOIN • SERVE
  </text>

  <line x1="155" y1="1610" x2="925" y2="1610"
        stroke="#5ec8ff" stroke-width="2" opacity="0.7"/>
  <text x="540" y="1692" text-anchor="middle" fill="#ffffff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="31" font-weight="900" letter-spacing="4">
    BELIEVE • BELONG • BECOME
  </text>
  <text x="540" y="1770" text-anchor="middle" fill="#a979ff"
        font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="24" font-weight="900" letter-spacing="3">
    #GREATERIMPACT
  </text>
`);

await sharp(endBackground)
  .composite([
    { input: endOverlay, left: 0, top: 0 },
    { input: qrBuffer, left: 350, top: 535 },
    { input: logoBuffer, left: 494, top: 1800 },
  ])
  .png({ quality: 100 })
  .toFile(path.join(sceneDir, "06-call-to-action.png"));

const scenePaths = [
  "01-all-teams.png",
  "02-hospitality.png",
  "03-praise-worship.png",
  "04-ushers.png",
  "05-security.png",
  "06-call-to-action.png",
].map((filename) => path.join(sceneDir, filename));

const durations = [5.0, 4.7, 4.7, 4.7, 4.7, 7.0];
const transitionDuration = 0.6;
const transitionOffsets = [4.4, 8.5, 12.6, 16.7, 20.8];

const ffmpegArgs = ["-y"];
for (let index = 0; index < scenePaths.length; index += 1) {
  ffmpegArgs.push(
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

const filters = scenePaths.map((_, index) => {
  const frames = Math.ceil(durations[index] * 30);
  const zoomExpression =
    index % 2 === 0
      ? `min(zoom+0.00022,1.038)`
      : `max(1.0,1.038-0.00022*on)`;
  return `[${index}:v]scale=1080:1920,zoompan=z='${zoomExpression}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30,trim=duration=${durations[index]},setpts=PTS-STARTPTS[v${index}]`;
});

filters.push(
  `[v0][v1]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionOffsets[0]}[x1]`,
  `[x1][v2]xfade=transition=smoothleft:duration=${transitionDuration}:offset=${transitionOffsets[1]}[x2]`,
  `[x2][v3]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionOffsets[2]}[x3]`,
  `[x3][v4]xfade=transition=smoothright:duration=${transitionDuration}:offset=${transitionOffsets[3]}[x4]`,
  `[x4][v5]xfade=transition=fade:duration=${transitionDuration}:offset=${transitionOffsets[4]},format=yuv420p[vout]`,
);

ffmpegArgs.push(
  "-filter_complex",
  filters.join(";"),
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

const result = spawnSync("ffmpeg", ffmpegArgs, {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (result.status !== 0) {
  throw new Error(`ffmpeg failed:\n${result.stderr}`);
}

console.log(`Created ${outputPath}`);
