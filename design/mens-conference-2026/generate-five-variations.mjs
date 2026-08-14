import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const campaignDir = path.dirname(currentFile);
const assetsDir = path.join(campaignDir, "assets");
const finalDir = path.join(campaignDir, "variations", "final");

const portraitPath = path.join(assetsDir, "pastor-t-ngwenya-cutout.png");
const logoPath = path.join(assetsDir, "renewed-life-logo-mark.png");

const designWidth = 1080;
const designHeight = 1350;
const canvasWidth = 2160;
const canvasHeight = 2700;
const scale = canvasWidth / designWidth;

await fs.mkdir(finalDir, { recursive: true });

const svg = (content, width = canvasWidth, height = canvasHeight) =>
  Buffer.from(`
    <svg width="${width}" height="${height}"
         viewBox="0 0 ${designWidth} ${designHeight}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="copper" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#7C3514"/>
          <stop offset="30%" stop-color="#F08A36"/>
          <stop offset="62%" stop-color="#C9662A"/>
          <stop offset="100%" stop-color="#6D2B11"/>
        </linearGradient>
        <linearGradient id="blueprint" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#4D9DFF"/>
          <stop offset="45%" stop-color="#C7F6FF"/>
          <stop offset="100%" stop-color="#31D3EF"/>
        </linearGradient>
        <linearGradient id="editorialGold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#8E6A26"/>
          <stop offset="48%" stop-color="#D7B765"/>
          <stop offset="100%" stop-color="#9D7730"/>
        </linearGradient>
        <linearGradient id="royalGold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#9A6B22"/>
          <stop offset="45%" stop-color="#F2CF78"/>
          <stop offset="100%" stop-color="#A9792C"/>
        </linearGradient>
        <linearGradient id="sunriseGold" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#F19A35"/>
          <stop offset="48%" stop-color="#FFE09A"/>
          <stop offset="100%" stop-color="#E87F27"/>
        </linearGradient>
        <linearGradient id="darkFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#020608" stop-opacity="0"/>
          <stop offset="54%" stop-color="#020608" stop-opacity="0.26"/>
          <stop offset="100%" stop-color="#020608" stop-opacity="0.96"/>
        </linearGradient>
        <linearGradient id="navyFade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#031126" stop-opacity="0"/>
          <stop offset="54%" stop-color="#031126" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="#020918" stop-opacity="0.97"/>
        </linearGradient>
        <radialGradient id="portraitHalo">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.32"/>
          <stop offset="58%" stop-color="#FFFFFF" stop-opacity="0.08"/>
          <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
        </radialGradient>
        <filter id="shadow" x="-45%" y="-45%" width="190%" height="200%">
          <feDropShadow dx="0" dy="16" stdDeviation="18"
                        flood-color="#000000" flood-opacity="0.72"/>
        </filter>
        <filter id="softShadow" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="7" stdDeviation="9"
                        flood-color="#000000" flood-opacity="0.48"/>
        </filter>
        <filter id="lightShadow" x="-40%" y="-40%" width="180%" height="190%">
          <feDropShadow dx="0" dy="8" stdDeviation="10"
                        flood-color="#7C6B51" flood-opacity="0.25"/>
        </filter>
      </defs>
      ${content}
    </svg>
  `);

const brandHeader = ({
  dark = true,
  accent = "#E8B551",
  label = "MEN'S CONFERENCE • 2026",
}) => `
  <text x="130" y="53" fill="${dark ? "#FFFFFF" : "#17191A"}"
        font-family="Avenir Next, Arial, sans-serif"
        font-size="16" font-weight="850" letter-spacing="1.55">
    RENEWED LIFE INTERNATIONAL
  </text>
  <text x="130" y="75" fill="${accent}"
        font-family="Avenir Next, Arial, sans-serif"
        font-size="9.5" font-weight="850" letter-spacing="2.8">
    BELIEVE • BELONG • BECOME
  </text>
  <g transform="translate(795 29)">
    <rect width="232" height="52" rx="26"
          fill="${dark ? "#05090D" : "#FBF8EF"}"
          fill-opacity="${dark ? "0.68" : "0.88"}"
          stroke="${accent}" stroke-opacity="0.78"/>
    <text x="116" y="32" text-anchor="middle"
          fill="${dark ? "#FFFFFF" : "#17191A"}"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="10.5" font-weight="900" letter-spacing="2">
      ${label}
    </text>
  </g>
`;

const hostLabel = ({
  x,
  y,
  accent,
  dark = true,
  compact = false,
}) => `
  <g transform="translate(${x} ${y})" filter="url(#softShadow)">
    <rect width="${compact ? 180 : 224}" height="${compact ? 60 : 76}" rx="10"
          fill="${dark ? "#060B0E" : "#FFFDF7"}"
          fill-opacity="${dark ? "0.80" : "0.92"}"
          stroke="${accent}" stroke-opacity="0.74"/>
    <rect width="${compact ? 49 : 58}" height="20" rx="0"
          fill="${accent}"/>
    <text x="${compact ? 24.5 : 29}" y="14" text-anchor="middle"
          fill="${dark ? "#071014" : "#FFFFFF"}"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="8.5" font-weight="950" letter-spacing="1.3">
      HOST
    </text>
    <text x="14" y="${compact ? 42 : 47}"
          fill="${dark ? "#FFFFFF" : "#17191A"}"
          font-family="DIN Condensed, Impact, sans-serif"
          font-size="${compact ? 20 : 25}" font-weight="900"
          letter-spacing="0.5">
      PASTOR T. NGWENYA
    </text>
    ${
      compact
        ? ""
        : `<text x="14" y="66" fill="${accent}"
                 font-family="Avenir Next, Arial, sans-serif"
                 font-size="8.5" font-weight="850" letter-spacing="1.8">
             RENEWED LIFE INTERNATIONAL
           </text>`
    }
  </g>
`;

const personIcon = ({ cx, cy, r, accent, fillOpacity = 0.10 }) => `
  <circle cx="${cx}" cy="${cy - r * 0.36}" r="${r * 0.27}"
          fill="${accent}" fill-opacity="${fillOpacity}"
          stroke="${accent}" stroke-opacity="0.72" stroke-width="1.5"/>
  <path d="M ${cx - r * 0.58} ${cy + r * 0.58}
           C ${cx - r * 0.51} ${cy + r * 0.05},
             ${cx - r * 0.28} ${cy - r * 0.02},
             ${cx} ${cy - r * 0.02}
           C ${cx + r * 0.28} ${cy - r * 0.02},
             ${cx + r * 0.51} ${cy + r * 0.05},
             ${cx + r * 0.58} ${cy + r * 0.58} Z"
        fill="${accent}" fill-opacity="${fillOpacity}"
        stroke="${accent}" stroke-opacity="0.68" stroke-width="1.5"/>
`;

const speakerCard = ({
  x,
  y,
  width = 222,
  height = 230,
  index,
  accent,
  dark = true,
}) => {
  const number = String(index + 1).padStart(2, "0");
  return `
    <g transform="translate(${x} ${y})" filter="url(${dark ? "#softShadow" : "#lightShadow"})">
      <rect width="${width}" height="${height}" rx="15"
            fill="${dark ? "#060D10" : "#FFFDF7"}"
            fill-opacity="${dark ? "0.86" : "0.92"}"
            stroke="${accent}" stroke-opacity="0.72" stroke-width="1.4"/>
      ${personIcon({
        cx: width / 2,
        cy: height * 0.38,
        r: Math.min(width * 0.42, height * 0.34),
        accent,
        fillOpacity: dark ? 0.11 : 0.07,
      })}
      <line x1="15" y1="${height - 55}" x2="${width - 15}" y2="${height - 55}"
            stroke="${accent}" stroke-opacity="0.46"/>
      <text x="15" y="${height - 34}" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9" font-weight="900" letter-spacing="1.8">
        SPEAKER ${number}
      </text>
      <text x="15" y="${height - 14}" fill="${dark ? "#FFFFFF" : "#1A1B1B"}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="11.5" font-weight="900" letter-spacing="0.45">
        TO BE ANNOUNCED
      </text>
    </g>
  `;
};

const speakerWideCard = ({
  x,
  y,
  width = 450,
  height = 154,
  index,
  accent,
}) => {
  const number = String(index + 1).padStart(2, "0");
  return `
    <g transform="translate(${x} ${y})" filter="url(#softShadow)">
      <rect width="${width}" height="${height}" rx="13"
            fill="#03102B" fill-opacity="0.78"
            stroke="${accent}" stroke-opacity="0.70" stroke-width="1.3"/>
      <rect x="11" y="11" width="124" height="${height - 22}" rx="9"
            fill="#071B43" fill-opacity="0.88"
            stroke="#FFFFFF" stroke-opacity="0.11"/>
      ${personIcon({
        cx: 73,
        cy: height / 2,
        r: 61,
        accent,
        fillOpacity: 0.08,
      })}
      <text x="158" y="51" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10" font-weight="900" letter-spacing="2.1">
        SPEAKER ${number}
      </text>
      <text x="158" y="84" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="24" font-weight="900" letter-spacing="0.5">
        TO BE ANNOUNCED
      </text>
      <text x="158" y="113" fill="#B7D9ED"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9.5" font-weight="760" letter-spacing="1.35">
        GUEST SPEAKER
      </text>
      <line x1="158" y1="128" x2="${width - 22}" y2="128"
            stroke="${accent}" stroke-opacity="0.55"/>
    </g>
  `;
};

const speakerCompactCard = ({
  x,
  y,
  index,
  accent,
}) => {
  const number = String(index + 1).padStart(2, "0");
  return `
    <g transform="translate(${x} ${y})" filter="url(#softShadow)">
      <rect width="220" height="150" rx="13"
            fill="#06152C" fill-opacity="0.84"
            stroke="${accent}" stroke-opacity="0.72"/>
      <rect x="10" y="10" width="84" height="130" rx="9"
            fill="#071B43" fill-opacity="0.82"
            stroke="#FFFFFF" stroke-opacity="0.10"/>
      ${personIcon({
        cx: 52,
        cy: 75,
        r: 49,
        accent,
        fillOpacity: 0.09,
      })}
      <text x="108" y="43" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.5" font-weight="900" letter-spacing="1.5">
        SPEAKER ${number}
      </text>
      <text x="108" y="74" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="18" font-weight="900">
        TO BE
      </text>
      <text x="108" y="98" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="18" font-weight="900">
        ANNOUNCED
      </text>
      <line x1="108" y1="117" x2="201" y2="117"
            stroke="${accent}" stroke-opacity="0.55"/>
    </g>
  `;
};

const speakerMedallion = ({
  cx,
  cy,
  index,
  accent,
  dark = true,
}) => {
  const number = String(index + 1).padStart(2, "0");
  return `
    <g filter="url(${dark ? "#softShadow" : "#lightShadow"})">
      <circle cx="${cx}" cy="${cy}" r="97"
              fill="${dark ? "#071014" : "#FFFDF7"}"
              fill-opacity="${dark ? "0.82" : "0.88"}"
              stroke="${accent}" stroke-width="2" stroke-opacity="0.82"/>
      <circle cx="${cx}" cy="${cy}" r="84"
              fill="none" stroke="${accent}" stroke-opacity="0.34"/>
      ${personIcon({
        cx,
        cy,
        r: 77,
        accent,
        fillOpacity: dark ? 0.10 : 0.06,
      })}
      <rect x="${cx - 92}" y="${cy + 104}" width="184" height="46" rx="9"
            fill="${dark ? "#071014" : "#FFFDF7"}"
            fill-opacity="${dark ? "0.88" : "0.94"}"
            stroke="${accent}" stroke-opacity="0.58"/>
      <text x="${cx}" y="${cy + 123}" text-anchor="middle" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.5" font-weight="900" letter-spacing="1.8">
        SPEAKER ${number}
      </text>
      <text x="${cx}" y="${cy + 142}" text-anchor="middle"
            fill="${dark ? "#FFFFFF" : "#17191A"}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="900">
        TO BE ANNOUNCED
      </text>
    </g>
  `;
};

const footer = ({
  y,
  accent,
  dark = true,
  compact = false,
}) => {
  const panelFill = dark ? "#050D13" : "#FFFDF7";
  const text = dark ? "#FFFFFF" : "#17191A";
  const softText = dark ? "#C8D6D9" : "#58544B";
  const panelWidth = 970;
  const panelHeight = compact ? 118 : 132;

  return `
    <g transform="translate(55 ${y})" filter="url(${dark ? "#softShadow" : "#lightShadow"})">
      <rect width="${panelWidth}" height="${panelHeight}" rx="17"
            fill="${panelFill}" fill-opacity="${dark ? "0.91" : "0.92"}"
            stroke="${dark ? "#FFFFFF" : "#17191A"}" stroke-opacity="0.14"/>
      <rect width="11" height="${panelHeight}" rx="5.5" fill="${accent}"/>
      <line x1="354" y1="20" x2="354" y2="${panelHeight - 20}"
            stroke="${text}" stroke-opacity="0.14"/>

      <g transform="translate(38 ${compact ? 20 : 24})">
        <rect width="60" height="60" rx="12"
              fill="${accent}" fill-opacity="0.11"
              stroke="${accent}" stroke-opacity="0.72"/>
        <path d="M16 24 H44 V47 H16 Z M21 16 V27 M39 16 V27 M16 31 H44"
              fill="none" stroke="${accent}" stroke-width="2"/>
        <text x="80" y="17" fill="${accent}"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="9.5" font-weight="900" letter-spacing="2">
          SATURDAY
        </text>
        <text x="80" y="45" fill="${text}"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="26" font-weight="900">
          26 SEPTEMBER
        </text>
        <text x="80" y="65" fill="${softText}"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="11" font-weight="850" letter-spacing="1.7">
          2026
        </text>
      </g>

      <g transform="translate(390 ${compact ? 20 : 24})">
        <rect width="60" height="60" rx="12"
              fill="${accent}" fill-opacity="0.11"
              stroke="${accent}" stroke-opacity="0.72"/>
        <path d="M30 14 C19 14 13 23 13 32 C13 44 30 55 30 55
                 C30 55 47 44 47 32 C47 23 41 14 30 14 Z"
              fill="none" stroke="${accent}" stroke-width="2"/>
        <circle cx="30" cy="31.5" r="5"
                fill="none" stroke="${accent}" stroke-width="2"/>
        <text x="80" y="17" fill="${accent}"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="9.5" font-weight="900" letter-spacing="2">
          VENUE
        </text>
        <text x="80" y="49" fill="${text}"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="29" font-weight="900" letter-spacing="0.4">
          MAMPURUT HALL
        </text>
      </g>
    </g>

    <g transform="translate(55 ${y + panelHeight + 18})">
      <rect width="970" height="50" rx="25"
            fill="${dark ? "#090F12" : "#FFFDF7"}"
            fill-opacity="${dark ? "0.90" : "0.92"}"
            stroke="${accent}" stroke-opacity="0.48"/>
      <text x="24" y="20" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.5" font-weight="900" letter-spacing="1.7">
        FOR MORE INFORMATION
      </text>
      <text x="24" y="39" fill="${text}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="12.5" font-weight="850">
        PASTOR JOSEPH MAJILA  •  084 409 5904
      </text>
      <line x1="555" y1="12" x2="555" y2="38"
            stroke="${text}" stroke-opacity="0.17"/>
      <text x="580" y="20" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.5" font-weight="900" letter-spacing="1.7">
        FOLLOW &amp; CONNECT
      </text>
      <text x="580" y="39" fill="${text}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="12.5" font-weight="900">
        @renewedlifeint
      </text>
    </g>

    <g transform="translate(55 ${y + panelHeight + 80})"
       filter="url(${dark ? "#softShadow" : "#lightShadow"})">
      <rect width="970" height="102" rx="16"
            fill="${dark ? "#090F12" : "#FFFDF7"}"
            fill-opacity="${dark ? "0.93" : "0.95"}"
            stroke="${accent}" stroke-opacity="0.56"/>
      <rect width="8" height="102" rx="4" fill="${accent}"/>
      <text x="25" y="23" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="9" font-weight="950" letter-spacing="2">
        TOPICS ON THE DAY
      </text>
      <text x="945" y="23" text-anchor="end" fill="${softText}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.2" font-weight="850" letter-spacing="1.1">
        TIKTOK  •  FACEBOOK  •  INSTAGRAM  •  YOUTUBE
      </text>
      <line x1="25" y1="34" x2="945" y2="34"
            stroke="${accent}" stroke-opacity="0.36"/>
      <text x="25" y="62" fill="${text}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="13.2" font-weight="900" letter-spacing="0.45">
        UNGAZIBULALI NDODA  •  BIBLICAL FATHERHOOD
      </text>
      <text x="25" y="86" fill="${text}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="12.4" font-weight="850" letter-spacing="0.35">
        MENTAL WELLNESS  •  FINANCIAL WELLNESS  •  AND MANY MORE
      </text>
      <text x="945" y="86" text-anchor="end" fill="${accent}"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="8.2" font-weight="900" letter-spacing="1.15">
        4 SPEAKERS TO BE ANNOUNCED
      </text>
    </g>
  `;
};

const portraitSource = await sharp(portraitPath)
  .trim({
    background: { r: 0, g: 0, b: 0, alpha: 0 },
    threshold: 2,
  })
  .png()
  .toBuffer();

const logo = await sharp(logoPath)
  .resize({
    width: Math.round(65 * scale),
    height: Math.round(65 * scale),
    fit: "contain",
  })
  .png()
  .toBuffer();

const variants = [
  {
    number: "01",
    slug: "forged-steel",
    title: "Forged Steel",
    background: "variation-01-forged-steel-background.png",
    portrait: { x: 520, y: 80, width: 555, saturation: 0.84 },
    logo: { x: 49, y: 27 },
    overlay: () => svg(`
      <rect y="500" width="1080" height="850" fill="url(#darkFade)"/>
      <rect x="35" y="105" width="474" height="363" rx="18"
            fill="#090705" fill-opacity="0.60"
            stroke="#D66F2C" stroke-opacity="0.30"/>
      ${brandHeader({ dark: true, accent: "#E67B33" })}
      <text x="58" y="151" fill="#E77B34"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="900" letter-spacing="3.2">
        THEME
      </text>
      <text x="58" y="226" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="76" font-weight="900" letter-spacing="0.8">
        BUILDING
      </text>
      <text x="58" y="302" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="76" font-weight="900" letter-spacing="0.8">
        MEN,
      </text>
      <text x="58" y="359" fill="#F09A55"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="49" font-weight="900" letter-spacing="1">
        REBUILDING
      </text>
      <text x="58" y="423" fill="url(#copper)"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="67" font-weight="900" letter-spacing="0.5">
        NATIONS
      </text>
      <line x1="58" y1="445" x2="475" y2="445"
            stroke="url(#copper)" stroke-width="3"/>
      ${hostLabel({
        x: 805,
        y: 394,
        accent: "#E67B33",
        dark: true,
        compact: true,
      })}
      ${[45, 301, 557, 813]
        .map((x, index) =>
          speakerCard({
            x,
            y: 535,
            index,
            accent: index % 2 ? "#E67B33" : "#F1A25C",
            dark: true,
          }),
        )
        .join("")}
      <text x="540" y="809" text-anchor="middle" fill="#F0A163"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10" font-weight="900" letter-spacing="4">
        MEN'S CONFERENCE 2026
      </text>
      ${footer({ y: 845, accent: "#E67B33", dark: true })}
      <rect y="1338" width="1080" height="12" fill="url(#copper)"/>
    `),
  },
  {
    number: "02",
    slug: "blueprint-builders",
    title: "Blueprint Builders",
    background: "variation-02-blueprint-builders-background.png",
    portrait: { x: 48, y: 112, width: 420, saturation: 0.83 },
    logo: { x: 49, y: 27 },
    overlay: () => svg(`
      <rect y="1010" width="1080" height="340" fill="#020B21" fill-opacity="0.88"/>
      <rect x="476" y="118" width="550" height="407" rx="18"
            fill="#020B22" fill-opacity="0.62"
            stroke="#52D8F2" stroke-opacity="0.35"/>
      ${brandHeader({ dark: true, accent: "#6DE4F5" })}
      <text x="507" y="164" fill="#6DE4F5"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="900" letter-spacing="3.2">
        THEME
      </text>
      <text x="507" y="239" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="72" font-weight="900">
        BUILDING
      </text>
      <text x="507" y="313" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="72" font-weight="900">
        MEN,
      </text>
      <text x="507" y="374" fill="#AEEFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="50" font-weight="900" letter-spacing="0.6">
        REBUILDING
      </text>
      <text x="507" y="448" fill="url(#blueprint)"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="70" font-weight="900">
        NATIONS
      </text>
      <path d="M507 474 H992" stroke="#66E1F5" stroke-width="2"/>
      ${hostLabel({
        x: 55,
        y: 528,
        accent: "#6DE4F5",
        dark: true,
        compact: false,
      })}
      ${speakerWideCard({
        x: 55,
        y: 665,
        index: 0,
        accent: "#6DE4F5",
      })}
      ${speakerWideCard({
        x: 575,
        y: 665,
        index: 1,
        accent: "#AEEFFF",
      })}
      ${speakerWideCard({
        x: 55,
        y: 837,
        index: 2,
        accent: "#AEEFFF",
      })}
      ${speakerWideCard({
        x: 575,
        y: 837,
        index: 3,
        accent: "#6DE4F5",
      })}
      ${footer({ y: 1033, accent: "#6DE4F5", dark: true, compact: true })}
      <rect y="1338" width="1080" height="12" fill="url(#blueprint)"/>
    `),
  },
  {
    number: "03",
    slug: "ivory-editorial",
    title: "Ivory Editorial",
    background: "variation-03-ivory-editorial-background.png",
    portrait: { x: 55, y: 135, width: 440, saturation: 0.78 },
    logo: { x: 49, y: 27 },
    overlay: () => svg(`
      <rect width="1080" height="1350" fill="#FFFDF7" fill-opacity="0.08"/>
      <ellipse cx="271" cy="416" rx="255" ry="330"
               fill="url(#portraitHalo)" opacity="0.72"/>
      ${brandHeader({ dark: false, accent: "#A47A2D" })}
      <text x="510" y="164" fill="#A47A2D"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="900" letter-spacing="3.4">
        THEME
      </text>
      <text x="510" y="248" fill="#17191A"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="76" font-weight="900" letter-spacing="0.4">
        BUILDING
      </text>
      <text x="510" y="323" fill="#17191A"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="76" font-weight="900" letter-spacing="0.4">
        MEN,
      </text>
      <text x="510" y="384" fill="#A47A2D"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="48" font-weight="900" letter-spacing="0.8">
        REBUILDING
      </text>
      <text x="510" y="459" fill="url(#editorialGold)"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="70" font-weight="900" letter-spacing="0.2">
        NATIONS
      </text>
      <line x1="510" y1="481" x2="1003" y2="481"
            stroke="#17191A" stroke-opacity="0.52"/>
      ${hostLabel({
        x: 66,
        y: 612,
        accent: "#A47A2D",
        dark: false,
        compact: false,
      })}
      ${[159, 413, 667, 921]
        .map((cx, index) =>
          speakerMedallion({
            cx,
            cy: 768,
            index,
            accent: "#A47A2D",
            dark: false,
          }),
        )
        .join("")}
      ${footer({ y: 975, accent: "#A47A2D", dark: false })}
      <rect y="1338" width="1080" height="12" fill="url(#editorialGold)"/>
    `),
  },
  {
    number: "04",
    slug: "royal-midnight",
    title: "Royal Midnight",
    background: "variation-04-royal-midnight-background.png",
    portrait: { x: 270, y: 92, width: 540, saturation: 0.80 },
    logo: { x: 49, y: 27 },
    overlay: () => svg(`
      <rect y="435" width="1080" height="915" fill="url(#navyFade)"/>
      ${brandHeader({ dark: true, accent: "#E5BD67" })}
      ${hostLabel({
        x: 76,
        y: 315,
        accent: "#E5BD67",
        dark: true,
        compact: false,
      })}
      <g filter="url(#shadow)">
        <text x="540" y="552" text-anchor="middle" fill="#E5BD67"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="10.5" font-weight="900" letter-spacing="4.5">
          THEME
        </text>
        <text x="540" y="619" text-anchor="middle" fill="#FFFFFF"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="66" font-weight="900" letter-spacing="0.8">
          BUILDING MEN,
        </text>
        <text x="540" y="684" text-anchor="middle" fill="url(#royalGold)"
              font-family="DIN Condensed, Impact, sans-serif"
              font-size="59" font-weight="900" letter-spacing="0.2">
          REBUILDING NATIONS
        </text>
      </g>
      ${[45, 301, 557, 813]
        .map((x, index) =>
          speakerCard({
            x,
            y: 725,
            height: 222,
            index,
            accent: index % 2 ? "#B99BEE" : "#E5BD67",
            dark: true,
          }),
        )
        .join("")}
      ${footer({ y: 980, accent: "#E5BD67", dark: true })}
      <rect y="1338" width="1080" height="12" fill="url(#royalGold)"/>
    `),
  },
  {
    number: "05",
    slug: "sunrise-foundations",
    title: "Sunrise Foundations",
    background: "variation-05-sunrise-foundations-background.png",
    portrait: { x: 8, y: 368, width: 560, saturation: 0.90 },
    logo: { x: 49, y: 27 },
    overlay: () => svg(`
      <rect y="960" width="1080" height="390" fill="#031329" fill-opacity="0.92"/>
      <rect x="450" y="115" width="580" height="402" rx="20"
            fill="#06152C" fill-opacity="0.68"
            stroke="#FFD078" stroke-opacity="0.44"/>
      ${brandHeader({ dark: true, accent: "#FFD078" })}
      <text x="486" y="161" fill="#FFD078"
            font-family="Avenir Next, Arial, sans-serif"
            font-size="10.5" font-weight="900" letter-spacing="3.2">
        THEME
      </text>
      <text x="486" y="237" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="72" font-weight="900">
        BUILDING
      </text>
      <text x="486" y="310" fill="#FFFFFF"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="72" font-weight="900">
        MEN,
      </text>
      <text x="486" y="370" fill="#FFE1A0"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="49" font-weight="900">
        REBUILDING
      </text>
      <text x="486" y="445" fill="url(#sunriseGold)"
            font-family="DIN Condensed, Impact, sans-serif"
            font-size="70" font-weight="900">
        NATIONS
      </text>
      <line x1="486" y1="471" x2="990" y2="471"
            stroke="#FFD078" stroke-width="2"/>
      ${hostLabel({
        x: 54,
        y: 887,
        accent: "#FFD078",
        dark: true,
        compact: true,
      })}
      ${speakerCompactCard({
        x: 575,
        y: 548,
        index: 0,
        accent: "#FFD078",
      })}
      ${speakerCompactCard({
        x: 805,
        y: 548,
        index: 1,
        accent: "#F0A254",
      })}
      ${speakerCompactCard({
        x: 575,
        y: 716,
        index: 2,
        accent: "#FFD078",
      })}
      ${speakerCompactCard({
        x: 805,
        y: 716,
        index: 3,
        accent: "#F0A254",
      })}
      ${footer({ y: 1033, accent: "#FFD078", dark: true, compact: true })}
      <rect y="1338" width="1080" height="12" fill="url(#sunriseGold)"/>
    `),
  },
];

const generated = [];

for (const variant of variants) {
  const backgroundPath = path.join(assetsDir, variant.background);
  const portrait = await sharp(portraitSource)
    .resize({ width: Math.round(variant.portrait.width * scale) })
    .modulate({
      saturation: variant.portrait.saturation,
      brightness: 0.99,
    })
    .sharpen({ sigma: 0.65 })
    .png()
    .toBuffer();

  const highRes = await sharp(backgroundPath)
    .resize(canvasWidth, canvasHeight, {
      fit: "cover",
      position: "centre",
    })
    .composite([
      {
        input: portrait,
        left: Math.round(variant.portrait.x * scale),
        top: Math.round(variant.portrait.y * scale),
      },
      { input: variant.overlay(), left: 0, top: 0 },
      {
        input: logo,
        left: Math.round(variant.logo.x * scale),
        top: Math.round(variant.logo.y * scale),
      },
    ])
    .png()
    .toBuffer();

  const baseName = `variation-${variant.number}-${variant.slug}`;
  const highResPath = path.join(finalDir, `${baseName}-2160x2700.png`);
  const socialPath = path.join(finalDir, `${baseName}-1080x1350.png`);

  await sharp(highRes).toFile(highResPath);
  await sharp(highRes)
    .resize(1080, 1350, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toFile(socialPath);

  generated.push({
    ...variant,
    highResPath,
    socialPath,
  });
}

const contactWidth = 1080;
const contactHeight = 1050;
const thumbWidth = 300;
const thumbHeight = 375;
const contactBase = await sharp({
  create: {
    width: contactWidth,
    height: contactHeight,
    channels: 4,
    background: "#061014",
  },
})
  .png()
  .toBuffer();

const positions = [
  { x: 45, y: 95 },
  { x: 390, y: 95 },
  { x: 735, y: 95 },
  { x: 220, y: 585 },
  { x: 560, y: 585 },
];

const contactComposites = [];

for (let index = 0; index < generated.length; index += 1) {
  const item = generated[index];
  const position = positions[index];
  const thumb = await sharp(item.socialPath)
    .resize(thumbWidth, thumbHeight, { fit: "cover" })
    .png()
    .toBuffer();
  contactComposites.push({
    input: thumb,
    left: position.x,
    top: position.y,
  });
  contactComposites.push({
    input: Buffer.from(`
      <svg width="${thumbWidth}" height="80"
           xmlns="http://www.w3.org/2000/svg">
        <rect width="${thumbWidth}" height="80" fill="#071217"/>
        <text x="0" y="25" fill="#E5B957"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="14" font-weight="900" letter-spacing="1.3">
          ${item.number}
        </text>
        <text x="34" y="25" fill="#FFFFFF"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="14" font-weight="850">
          ${item.title}
        </text>
        <text x="34" y="48" fill="#9FB8BA"
              font-family="Avenir Next, Arial, sans-serif"
              font-size="9" font-weight="700" letter-spacing="1">
          BUILDING MEN • REBUILDING NATIONS
        </text>
        <line x1="0" y1="63" x2="${thumbWidth}" y2="63"
              stroke="#E5B957" stroke-opacity="0.48"/>
      </svg>
    `),
    left: position.x,
    top: position.y + thumbHeight + 10,
  });
}

const contactHeader = Buffer.from(`
  <svg width="${contactWidth}" height="${contactHeight}"
       xmlns="http://www.w3.org/2000/svg">
    <text x="45" y="48" fill="#FFFFFF"
          font-family="DIN Condensed, Impact, sans-serif"
          font-size="29" font-weight="900" letter-spacing="0.8">
      MEN'S CONFERENCE • FIVE DESIGN DIRECTIONS
    </text>
    <text x="45" y="72" fill="#80D8D2"
          font-family="Avenir Next, Arial, sans-serif"
          font-size="10" font-weight="850" letter-spacing="2">
      RENEWED LIFE INTERNATIONAL • 26 SEPTEMBER 2026
    </text>
  </svg>
`);

const contactSheetPath = path.join(
  finalDir,
  "mens-conference-five-variations-contact-sheet.png",
);

await sharp(contactBase)
  .composite([
    { input: contactHeader, left: 0, top: 0 },
    ...contactComposites,
  ])
  .png()
  .toFile(contactSheetPath);

console.log(
  JSON.stringify(
    {
      contactSheetPath,
      variants: generated.map(({ number, title, highResPath, socialPath }) => ({
        number,
        title,
        highResPath,
        socialPath,
      })),
    },
    null,
    2,
  ),
);
