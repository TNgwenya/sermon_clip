import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const currentFile = fileURLToPath(import.meta.url);
const posterDir = path.dirname(currentFile);
const projectRoot = path.resolve(posterDir, "../..");
const backgroundDir = path.join(posterDir, "backgrounds");
const outputDir = path.join(posterDir, "final");
const logoPath = path.join(
  projectRoot,
  "public/uploads/branding/church-logo-1782126430125.png",
);

const width = 1080;
const height = 1350;

const escapeXml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const svg = (content) =>
  Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
         xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="10" stdDeviation="12"
                        flood-color="#000000" flood-opacity="0.32"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="5" stdDeviation="7"
                        flood-color="#000000" flood-opacity="0.24"/>
        </filter>
        <linearGradient id="hospitalityBottom" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#0d233d" stop-opacity="0"/>
          <stop offset="100%" stop-color="#0d233d" stop-opacity="0.97"/>
        </linearGradient>
        <linearGradient id="worshipRight" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#110b35" stop-opacity="0"/>
          <stop offset="72%" stop-color="#110b35" stop-opacity="0.82"/>
          <stop offset="100%" stop-color="#0b0726" stop-opacity="0.97"/>
        </linearGradient>
        <linearGradient id="securityLeft" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#071421" stop-opacity="0.98"/>
          <stop offset="72%" stop-color="#071421" stop-opacity="0.72"/>
          <stop offset="100%" stop-color="#071421" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${content}
    </svg>
  `);

const baseImage = async (filename, position = "centre") =>
  sharp(path.join(backgroundDir, filename))
    .resize(width, height, { fit: "cover", position })
    .png()
    .toBuffer();

const rawLogoCrop = await sharp(logoPath)
  .extract({ left: 0, top: 0, width: 2000, height: 940 })
  .png()
  .toBuffer();

const logoCrop = await sharp(rawLogoCrop).trim().png().toBuffer();

const logoMask = Buffer.from(`
  <svg width="118" height="118" viewBox="0 0 118 118"
       xmlns="http://www.w3.org/2000/svg">
    <circle cx="59" cy="59" r="57" fill="#ffffff"/>
  </svg>
`);

const logoBuffer = await sharp(logoCrop)
  .resize({ width: 118, height: 118, fit: "contain" })
  .composite([{ input: logoMask, blend: "dest-in" }])
  .png()
  .toBuffer();

const brandRow = ({
  churchFill,
  churchX = 188,
  churchY = 84,
  churchSize = 28,
  tracking = 4,
}) => `
  <text x="${churchX}" y="${churchY}"
        fill="${churchFill}" font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
        font-size="${churchSize}" font-weight="700" letter-spacing="${tracking}">
    RENEWED LIFE INTERNATIONAL
  </text>
`;

const writePoster = async ({
  background,
  backgroundPosition,
  filename,
  logoLeft,
  logoTop,
  overlay,
}) => {
  const backgroundBuffer = await baseImage(background, backgroundPosition);
  await sharp(backgroundBuffer)
    .composite([
      { input: svg(overlay), left: 0, top: 0 },
      { input: logoBuffer, left: logoLeft, top: logoTop },
    ])
    .png({ quality: 100 })
    .toFile(path.join(outputDir, filename));
};

await writePoster({
  background: "hospitality.png",
  backgroundPosition: "centre",
  filename: "hospitality-volunteers.png",
  logoLeft: 55,
  logoTop: 36,
  overlay: `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#fff5e6" opacity="0.08"/>
    <path d="M0 0 H760 L610 705 H0 Z" fill="#fff6e8" opacity="0.92"/>
    <circle cx="662" cy="206" r="150" fill="#d86f3d" opacity="0.10"/>
    ${brandRow({ churchFill: "#10253d" })}

    <rect x="58" y="165" width="310" height="46" rx="23" fill="#cf6536"/>
    <text x="213" y="197" text-anchor="middle" fill="#fffaf2"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="800" letter-spacing="2.2">
      VOLUNTEERS NEEDED
    </text>

    <text x="58" y="300" fill="#10253d"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="90" font-weight="800" letter-spacing="-2">
      HELP PEOPLE
    </text>
    <text x="58" y="393" fill="#c95e36"
          font-family="Georgia, Times New Roman, serif"
          font-size="76" font-style="italic" font-weight="700">
      feel at home.
    </text>

    <line x1="58" y1="438" x2="425" y2="438" stroke="#d49b3a" stroke-width="5"/>
    <text x="58" y="492" fill="#26394c"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="30" font-weight="500">
      <tspan x="58" dy="0">Join the Hospitality Team and help</tspan>
      <tspan x="58" dy="40">create a warm welcome for every person.</tspan>
    </text>

    <rect x="0" y="890" width="${width}" height="460" fill="url(#hospitalityBottom)"/>
    <rect x="56" y="1114" width="482" height="78" rx="39"
          fill="#f1a33a" filter="url(#softShadow)"/>
    <text x="297" y="1166" text-anchor="middle" fill="#10253d"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="1.4">
      JOIN THE HOSPITALITY TEAM
    </text>
    <text x="58" y="1245" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="600">
      Speak to the Hospitality Leader at church
    </text>
    <text x="58" y="1303" fill="#f6b84f"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="800" letter-spacing="2.5">
      #GREATER IMPACT
    </text>
  `,
});

await writePoster({
  background: "praise-worship.png",
  backgroundPosition: "centre",
  filename: "praise-worship-volunteers.png",
  logoLeft: 894,
  logoTop: 42,
  overlay: `
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#worshipRight)"/>
    <path d="M1030 0 L1080 0 L650 1350 L555 1350 Z" fill="#b72bff" opacity="0.09"/>
    <path d="M1080 338 L1080 382 L645 1350 L616 1350 Z" fill="#f6b841" opacity="0.72"/>

    <text x="868" y="88" text-anchor="end" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="700" letter-spacing="3.5">
      RENEWED LIFE INTERNATIONAL
    </text>
    <text x="1015" y="206" text-anchor="end" fill="#f6c85b"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="2.6">
      PRAISE &amp; WORSHIP TEAM
    </text>
    <text x="1015" y="260" text-anchor="end" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="21" font-weight="700" letter-spacing="2.5">
      VOLUNTEERS NEEDED
    </text>

    <text x="1018" y="398" text-anchor="end" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="92" font-weight="900" letter-spacing="-1">
      USE YOUR
    </text>
    <text x="1018" y="500" text-anchor="end" fill="#f6bf45"
          font-family="Georgia, Times New Roman, serif"
          font-size="106" font-style="italic" font-weight="700">
      GIFT
    </text>
    <text x="1018" y="600" text-anchor="end" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="76" font-weight="900">
      FOR HIS GLORY
    </text>

    <text x="1015" y="690" text-anchor="end" fill="#eee8ff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="500">
      <tspan x="1015" dy="0">We’re looking for singers and musicians</tspan>
      <tspan x="1015" dy="39">ready to serve through worship.</tspan>
    </text>

    <rect x="568" y="1025" width="450" height="82" rx="8"
          fill="#f2b93f" filter="url(#shadow)"/>
    <text x="793" y="1079" text-anchor="middle" fill="#171033"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="29" font-weight="900" letter-spacing="1.4">
      READY TO SERVE?
    </text>
    <text x="1015" y="1160" text-anchor="end" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="26" font-weight="600">
      Speak to the Praise &amp; Worship Leader at church
    </text>
    <text x="1015" y="1294" text-anchor="end" fill="#f6c85b"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="800" letter-spacing="2.5">
      #GREATER IMPACT
    </text>
  `,
});

await writePoster({
  background: "ushers.png",
  backgroundPosition: "centre",
  filename: "ushers-volunteers.png",
  logoLeft: 54,
  logoTop: 35,
  overlay: `
    <rect x="0" y="0" width="${width}" height="${height}" fill="#072c26" opacity="0.12"/>
    <rect x="24" y="24" width="1032" height="1302" rx="12"
          fill="none" stroke="#d8ad57" stroke-width="3"/>
    <path d="M0 0 H1080 V555 Q540 650 0 555 Z" fill="#052f28" opacity="0.88"/>
    ${brandRow({ churchFill: "#fff8e9", churchX: 185, churchY: 84 })}

    <text x="540" y="180" text-anchor="middle" fill="#ddb35f"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="4">
      USHERING TEAM • VOLUNTEERS NEEDED
    </text>
    <line x1="290" y1="212" x2="790" y2="212" stroke="#d8ad57" stroke-width="2"/>

    <text x="540" y="330" text-anchor="middle" fill="#fffaf0"
          font-family="Georgia, Times New Roman, serif"
          font-size="90" font-weight="700">
      SERVE WITH
    </text>
    <text x="540" y="430" text-anchor="middle" fill="#ddb35f"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="104" font-weight="900" letter-spacing="1">
      EXCELLENCE
    </text>

    <text x="540" y="500" text-anchor="middle" fill="#f5f0e7"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="500">
      <tspan x="540" dy="0">Help create an orderly, welcoming and</tspan>
      <tspan x="540" dy="37">uplifting worship experience.</tspan>
    </text>

    <rect x="183" y="1116" width="714" height="90" rx="45"
          fill="#e0b862" filter="url(#shadow)"/>
    <text x="540" y="1175" text-anchor="middle" fill="#062e28"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="31" font-weight="900" letter-spacing="2">
      JOIN THE USHERING TEAM
    </text>
    <rect x="225" y="1226" width="630" height="50" rx="25" fill="#062e28" opacity="0.92"/>
    <text x="540" y="1260" text-anchor="middle" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="24" font-weight="600">
      Speak to the Ushering Leader at church
    </text>
    <text x="540" y="1311" text-anchor="middle" fill="#e6c77b"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="22" font-weight="800" letter-spacing="2.5">
      #GREATER IMPACT
    </text>
  `,
});

await writePoster({
  background: "security.png",
  backgroundPosition: "centre",
  filename: "security-volunteers.png",
  logoLeft: 55,
  logoTop: 38,
  overlay: `
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#securityLeft)"/>
    <path d="M0 0 H45 V1350 H0 Z" fill="#f49a32"/>
    <path d="M66 195 L115 165 L164 195 V258 C164 302 141 340 115 354
             C89 340 66 302 66 258 Z"
          fill="none" stroke="#5bb8ef" stroke-width="4" opacity="0.82"/>
    ${brandRow({ churchFill: "#ffffff" })}

    <text x="64" y="445" fill="#65c7ff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="23" font-weight="900" letter-spacing="3">
      SECURITY TEAM • VOLUNTEERS NEEDED
    </text>
    <text x="62" y="560" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="104" font-weight="900">
      SERVE.
    </text>
    <text x="62" y="660" fill="#f5a139"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="104" font-weight="900">
      PROTECT.
    </text>
    <text x="62" y="760" fill="#ffffff"
          font-family="Avenir Next Condensed, Helvetica Neue, Arial, sans-serif"
          font-size="104" font-weight="900">
      SUPPORT.
    </text>

    <line x1="64" y1="805" x2="445" y2="805" stroke="#5bb8ef" stroke-width="4"/>
    <text x="64" y="858" fill="#d9e7f0"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="27" font-weight="500">
      <tspan x="64" dy="0">Help us create a safe and peaceful</tspan>
      <tspan x="64" dy="38">environment for everyone to worship.</tspan>
    </text>

    <rect x="62" y="1002" width="384" height="76" rx="8"
          fill="#f49a32" filter="url(#softShadow)"/>
    <text x="254" y="1053" text-anchor="middle" fill="#081726"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="28" font-weight="900" letter-spacing="1.4">
      READY TO SERVE?
    </text>
    <text x="64" y="1134" fill="#ffffff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="600">
      <tspan x="64" dy="0">Speak to the Security Leader</tspan>
      <tspan x="64" dy="35">at church</tspan>
    </text>
    <text x="64" y="1297" fill="#65c7ff"
          font-family="Avenir Next, Helvetica Neue, Arial, sans-serif"
          font-size="25" font-weight="800" letter-spacing="2.5">
      #GREATER IMPACT
    </text>
  `,
});

console.log(`Created four department posters in ${outputDir}`);
