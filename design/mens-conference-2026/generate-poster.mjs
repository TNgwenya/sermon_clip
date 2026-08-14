import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const assetsDir = path.join(campaignDir, "assets");
const finalDir = path.join(campaignDir, "final");

const backgroundPath = path.join(assetsDir, "cinematic-city-background.png");
const portraitPath = path.join(assetsDir, "ps-joseph-cutout.png");
const logoPath = path.join(assetsDir, "renewed-life-logo-mark.png");

const socialPngPath = path.join(
  finalDir,
  "building-men-rebuilding-nations-social-1080x1350.png",
);
const socialJpgPath = path.join(
  finalDir,
  "building-men-rebuilding-nations-social-1080x1350.jpg",
);
const highResPngPath = path.join(
  finalDir,
  "building-men-rebuilding-nations-high-res-2160x2700.png",
);

const canvasWidth = 2160;
const canvasHeight = 2700;
const designWidth = 1080;
const designHeight = 1350;
const scale = canvasWidth / designWidth;

await fs.mkdir(finalDir, { recursive: true });

const svgBuffer = (content) =>
  Buffer.from(`
    <svg width="${canvasWidth}" height="${canvasHeight}"
         viewBox="0 0 ${designWidth} ${designHeight}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="deepFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#031014" stop-opacity="0"/>
          <stop offset="26%" stop-color="#031014" stop-opacity="0.06"/>
          <stop offset="58%" stop-color="#020a0d" stop-opacity="0.78"/>
          <stop offset="100%" stop-color="#010608" stop-opacity="0.98"/>
        </linearGradient>
        <linearGradient id="lowerPanel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#051418" stop-opacity="0.68"/>
          <stop offset="100%" stop-color="#02090b" stop-opacity="0.97"/>
        </linearGradient>
        <linearGradient id="gold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#A97827"/>
          <stop offset="35%" stop-color="#F0C76A"/>
          <stop offset="67%" stop-color="#D6A84B"/>
          <stop offset="100%" stop-color="#8E6420"/>
        </linearGradient>
        <linearGradient id="tealGold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7BE5DE"/>
          <stop offset="44%" stop-color="#EAFBF8"/>
          <stop offset="61%" stop-color="#F0C76A"/>
          <stop offset="100%" stop-color="#C99235"/>
        </linearGradient>
        <linearGradient id="slotFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0E3435" stop-opacity="0.82"/>
          <stop offset="100%" stop-color="#031215" stop-opacity="0.96"/>
        </linearGradient>
        <radialGradient id="hostHalo">
          <stop offset="0%" stop-color="#39D6CD" stop-opacity="0.38"/>
          <stop offset="58%" stop-color="#0B6C69" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="#06151C" stop-opacity="0"/>
        </radialGradient>
        <radialGradient id="goldHalo">
          <stop offset="0%" stop-color="#E9B54F" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="#E9B54F" stop-opacity="0"/>
        </radialGradient>
        <filter id="deepShadow" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="18" stdDeviation="22"
                        flood-color="#000000" flood-opacity="0.74"/>
        </filter>
        <filter id="softShadow" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="7" stdDeviation="10"
                        flood-color="#000000" flood-opacity="0.58"/>
        </filter>
        <filter id="goldGlow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="12"/>
        </filter>
        <filter id="titleShadow" x="-25%" y="-35%" width="150%" height="190%">
          <feDropShadow dx="0" dy="8" stdDeviation="7"
                        flood-color="#000000" flood-opacity="0.90"/>
        </filter>
      </defs>
      ${content}
    </svg>
  `);

const silhouette = (x, index) => {
  const accent = index % 2 === 0 ? "#79DDD5" : "#E6B858";
  const number = String(index + 1).padStart(2, "0");

  return `
    <g transform="translate(${x} 480)" filter="url(#softShadow)">
      <rect width="222" height="262" rx="16"
            fill="url(#slotFill)" stroke="${accent}" stroke-opacity="0.64"
            stroke-width="1.6"/>
      <rect x="10" y="10" width="202" height="176" rx="10"
            fill="#06171B" fill-opacity="0.72"
            stroke="#FFFFFF" stroke-opacity="0.08"/>
      <circle cx="111" cy="75" r="35"
              fill="${accent}" fill-opacity="0.16"
              stroke="${accent}" stroke-opacity="0.70" stroke-width="1.5"/>
      <path d="M45 170 C52 122 78 105 111 105 C144 105 170 122 177 170 Z"
            fill="${accent}" fill-opacity="0.13"
            stroke="${accent}" stroke-opacity="0.62" stroke-width="1.5"/>
      <circle cx="111" cy="75" r="3" fill="${accent}" opacity="0.85"/>
      <text x="18" y="213" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11" font-weight="800" letter-spacing="2.2">
        SPEAKER ${number}
      </text>
      <text x="18" y="237" fill="#F4F5EF"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="13" font-weight="850" letter-spacing="0.5">
        TO BE ANNOUNCED
      </text>
      <line x1="18" y1="247" x2="204" y2="247"
            stroke="${accent}" stroke-opacity="0.55"/>
    </g>
  `;
};

const preOverlay = svgBuffer(`
  <rect width="${designWidth}" height="${designHeight}" fill="#031014" opacity="0.14"/>
  <ellipse cx="548" cy="304" rx="330" ry="340" fill="url(#hostHalo)"/>
  <ellipse cx="540" cy="632" rx="510" ry="150" fill="url(#goldHalo)"/>
  <rect y="485" width="1080" height="865" fill="url(#deepFade)"/>
  <rect y="714" width="1080" height="636" fill="url(#lowerPanel)"/>
  <rect y="0" width="1080" height="1350" fill="none"
        stroke="#54D4CD" stroke-opacity="0.22" stroke-width="2"/>
  <path d="M0 443 H1080" stroke="#E8B551" stroke-opacity="0.26" stroke-width="1"/>
  <path d="M66 446 H1014" stroke="url(#gold)" stroke-opacity="0.60" stroke-width="2"/>
`);

const portrait = await sharp(portraitPath)
  .trim({
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    threshold: 2,
  })
  .resize({
    width: Math.round(650 * scale),
  })
  .modulate({ saturation: 0.92, brightness: 0.99 })
  .sharpen({ sigma: 0.7 })
  .png()
  .toBuffer();

const mainOverlay = svgBuffer(`
  <g>
    <text x="132" y="56" fill="#FFFFFF"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="17" font-weight="850" letter-spacing="1.7">
      RENEWED LIFE INTERNATIONAL
    </text>
    <text x="132" y="78" fill="#92DAD5"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="10.5" font-weight="750" letter-spacing="3.1">
      BELIEVE • BELONG • BECOME
    </text>
    <line x1="132" y1="91" x2="548" y2="91"
          stroke="url(#tealGold)" stroke-width="1.5" opacity="0.72"/>

    <g transform="translate(786 31)">
      <rect width="242" height="62" rx="31"
            fill="#031215" fill-opacity="0.74"
            stroke="#E9BC5D" stroke-opacity="0.72" stroke-width="1.4"/>
      <text x="121" y="26" text-anchor="middle" fill="#F0C76A"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="850" letter-spacing="2.6">
        MEN'S CONFERENCE
      </text>
      <text x="121" y="47" text-anchor="middle" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="18" font-weight="900" letter-spacing="2">
        2026
      </text>
    </g>

    <g transform="translate(764 222)" filter="url(#softShadow)">
      <path d="M0 0 H238 L218 90 H0 Z"
            fill="#031215" fill-opacity="0.80"
            stroke="#F0C76A" stroke-opacity="0.62"/>
      <rect width="63" height="23" fill="url(#gold)"/>
      <text x="31.5" y="16" text-anchor="middle" fill="#041014"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9.5" font-weight="900" letter-spacing="1.5">
        HOST
      </text>
      <text x="18" y="52" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="26" font-weight="900" letter-spacing="0.7">
        PS JOSEPH
      </text>
      <text x="18" y="78" fill="#F0C76A"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="26" font-weight="900" letter-spacing="0.7">
        MATJILA
      </text>
    </g>

    ${silhouette(45, 0)}
    ${silhouette(301, 1)}
    ${silhouette(557, 2)}
    ${silhouette(813, 3)}

    <g filter="url(#titleShadow)">
      <text x="540" y="800" text-anchor="middle" fill="#9EE8E2"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11.5" font-weight="900" letter-spacing="7.5">
        THEME
      </text>
      <line x1="284" y1="795" x2="449" y2="795"
            stroke="#6ED9D1" stroke-opacity="0.62"/>
      <line x1="631" y1="795" x2="796" y2="795"
            stroke="#E9BA58" stroke-opacity="0.62"/>

      <text x="540" y="870" text-anchor="middle" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="73" font-weight="900" letter-spacing="1">
        BUILDING MEN,
      </text>
      <text x="540" y="943" text-anchor="middle" fill="url(#gold)"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="66" font-weight="900" letter-spacing="0.2">
        REBUILDING NATIONS
      </text>
    </g>

    <g transform="translate(55 985)" filter="url(#softShadow)">
      <rect width="970" height="142" rx="18"
            fill="#07191C" fill-opacity="0.92"
            stroke="#FFFFFF" stroke-opacity="0.13"/>
      <rect width="12" height="142" rx="6" fill="url(#gold)"/>
      <line x1="353" y1="22" x2="353" y2="120"
            stroke="#FFFFFF" stroke-opacity="0.14"/>

      <g transform="translate(39 25)">
        <rect width="65" height="65" rx="12"
              fill="#D8AA4D" fill-opacity="0.14"
              stroke="#F0C76A" stroke-opacity="0.72"/>
        <path d="M17 25 H48 V50 H17 Z M23 17 V28 M42 17 V28 M17 32 H48"
              fill="none" stroke="#F0C76A" stroke-width="2"
              stroke-linecap="round" stroke-linejoin="round"/>
        <text x="84" y="21" fill="#83DDD6"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="10.5" font-weight="850" letter-spacing="2.3">
          SATURDAY
        </text>
        <text x="84" y="51" fill="#FFFFFF"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="28" font-weight="900" letter-spacing="0.3">
          26 SEPTEMBER
        </text>
        <text x="84" y="76" fill="#C9D8D6"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="12" font-weight="800" letter-spacing="2">
          2026
        </text>
      </g>

      <g transform="translate(391 25)">
        <rect width="65" height="65" rx="12"
              fill="#2BC7BE" fill-opacity="0.12"
              stroke="#78DDD6" stroke-opacity="0.68"/>
        <path d="M32.5 16 C21 16 15 25 15 34 C15 47 32.5 58 32.5 58
                 C32.5 58 50 47 50 34 C50 25 44 16 32.5 16 Z"
              fill="none" stroke="#83E3DC" stroke-width="2"/>
        <circle cx="32.5" cy="33.5" r="5.5"
                fill="none" stroke="#83E3DC" stroke-width="2"/>
        <text x="84" y="21" fill="#F0C76A"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="10.5" font-weight="850" letter-spacing="2.3">
          VENUE
        </text>
        <text x="84" y="55" fill="#FFFFFF"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="31" font-weight="900" letter-spacing="0.6">
          MAMPURUT HALL
        </text>
      </g>
    </g>

    <g transform="translate(55 1147)">
      <rect width="970" height="54" rx="27"
            fill="#D7A847" fill-opacity="0.11"
            stroke="#EAB956" stroke-opacity="0.52"/>
      <circle cx="31" cy="27" r="14"
              fill="#F0C76A" fill-opacity="0.17"
              stroke="#F0C76A" stroke-opacity="0.72"/>
      <path d="M25 18 C27 17 30 20 31 23 C32 25 30 27 29 28
               C33 34 38 35 39 34 C41 32 43 33 45 35
               C47 38 45 41 42 42 C34 43 22 31 21 22
               C21 20 23 18 25 18 Z"
            fill="#F0C76A"/>
      <text x="57" y="22" fill="#93DCD6"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9.5" font-weight="850" letter-spacing="2">
        FOR MORE INFORMATION
      </text>
      <text x="57" y="42" fill="#FFFFFF"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="14.5" font-weight="800" letter-spacing="0.45">
        PS JOSEPH MATJILA  •  084 409 5904
      </text>
      <line x1="552" y1="14" x2="552" y2="40"
            stroke="#FFFFFF" stroke-opacity="0.18"/>
      <text x="580" y="22" fill="#F0C76A"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9.5" font-weight="850" letter-spacing="2">
        FOLLOW &amp; CONNECT
      </text>
      <text x="580" y="42" fill="#FFFFFF"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="14.5" font-weight="850" letter-spacing="0.5">
        @renewedlifeint
      </text>
    </g>

    <g transform="translate(55 1220)">
      <text x="0" y="18" fill="#BFD0CE"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11" font-weight="760" letter-spacing="1.7">
        TIKTOK
      </text>
      <circle cx="91" cy="14" r="2" fill="#E7B657"/>
      <text x="106" y="18" fill="#BFD0CE"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11" font-weight="760" letter-spacing="1.7">
        FACEBOOK
      </text>
      <circle cx="227" cy="14" r="2" fill="#7CDDD5"/>
      <text x="242" y="18" fill="#BFD0CE"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11" font-weight="760" letter-spacing="1.7">
        INSTAGRAM
      </text>
      <circle cx="366" cy="14" r="2" fill="#E7B657"/>
      <text x="381" y="18" fill="#BFD0CE"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11" font-weight="760" letter-spacing="1.7">
        YOUTUBE
      </text>
      <line x1="0" y1="37" x2="970" y2="37"
            stroke="url(#tealGold)" stroke-opacity="0.48"/>
      <text x="970" y="18" text-anchor="end" fill="#7EDDD6"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="800" letter-spacing="2.1">
        FOUR SPEAKERS TO BE ANNOUNCED
      </text>
    </g>

    <text x="540" y="1306" text-anchor="middle" fill="#F0C76A"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="11" font-weight="850" letter-spacing="4.2">
      BUILDING MEN • REBUILDING NATIONS
    </text>
    <rect x="0" y="1338" width="1080" height="12" fill="url(#tealGold)"/>
  </g>
`);

const logo = await sharp(logoPath)
  .resize({
    width: Math.round(66 * scale),
    height: Math.round(66 * scale),
    fit: "contain",
  })
  .png()
  .toBuffer();

const highResPoster = await sharp(backgroundPath)
  .resize(canvasWidth, canvasHeight, { fit: "cover", position: "centre" })
  .modulate({ brightness: 0.94, saturation: 1.05 })
  .composite([
    { input: preOverlay, left: 0, top: 0 },
    {
      input: portrait,
      left: Math.round(215 * scale),
      top: Math.round(55 * scale),
    },
    { input: mainOverlay, left: 0, top: 0 },
    {
      input: logo,
      left: Math.round(50 * scale),
      top: Math.round(28 * scale),
    },
  ])
  .png()
  .toBuffer();

await sharp(highResPoster).toFile(highResPngPath);
await sharp(highResPoster)
  .resize(1080, 1350, { fit: "fill" })
  .png({ compressionLevel: 9 })
  .toFile(socialPngPath);
await sharp(highResPoster)
  .resize(1080, 1350, { fit: "fill" })
  .jpeg({ quality: 94, chromaSubsampling: "4:4:4" })
  .toFile(socialJpgPath);

console.log(
  JSON.stringify(
    {
      highResPngPath,
      socialPngPath,
      socialJpgPath,
    },
    null,
    2,
  ),
);
