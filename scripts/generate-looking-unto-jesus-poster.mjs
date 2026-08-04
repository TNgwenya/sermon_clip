import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const projectRoot = "/Users/thabangngwenya/Development/Projects/sermon_clip";
const outputDir = path.join(projectRoot, "design", "special-sunday-looking-unto-jesus");

const sources = {
  background:
    "/Users/thabangngwenya/.codex/generated_images/019fb910-37fb-77d3-86be-279eaa0c2f83/call_1yHqmJU701GMp1iTBwoenKXL.png",
  hosts:
    "/Users/thabangngwenya/Downloads/WhatsApp Image 2026-07-01 at 09.01.51.jpeg",
  guest:
    "/var/folders/6b/ntzn_cgs7tg7pszwmd6qht300000gn/T/codex-clipboard-b33a56fd-344e-43b5-b9d1-aa9c76c2c66c.jpg",
  logo:
    path.join(
      projectRoot,
      "public",
      "uploads",
      "branding",
      "church-logo-1782927847716.png",
    ),
};

const palette = {
  ink: "#061726",
  inkSoft: "#0A2235",
  blue: "#5CB3FF",
  teal: "#75D5C7",
  green: "#A8D876",
  gold: "#F5C56A",
  goldDeep: "#B98735",
  cream: "#FFF6E4",
  white: "#FFFFFF",
};

function svgBuffer(svg) {
  return Buffer.from(svg);
}

function roundedRectSvg(width, height, radius, fill = "#fff") {
  return svgBuffer(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" rx="${radius}" fill="${fill}"/>
    </svg>`,
  );
}

async function prepareLogoMark(width) {
  // The stored PNG is a transparent lockup. This crop isolates the original
  // church mark while the church name is typeset at full poster resolution.
  const cropped = await sharp(sources.logo)
    .extract({ left: 560, top: 110, width: 880, height: 850 })
    .png()
    .toBuffer();

  return sharp(cropped)
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .resize({ width, fit: "contain" })
    .modulate({ brightness: 1.28, saturation: 1.08 })
    .png()
    .toBuffer();
}

async function prepareHosts(width, height, radius) {
  const photo = await sharp(sources.hosts)
    .rotate()
    .resize({ width, height, fit: "cover", position: "attention" })
    .modulate({ saturation: 1.04, brightness: 0.98 })
    .sharpen({ sigma: 0.6 })
    .png()
    .toBuffer();

  return sharp(photo)
    .ensureAlpha()
    .composite([
      {
        input: roundedRectSvg(width, height, radius),
        blend: "dest-in",
      },
      {
        input: svgBuffer(
          `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="55%" stop-color="#03121F" stop-opacity="0"/>
                <stop offset="100%" stop-color="#03121F" stop-opacity=".84"/>
              </linearGradient>
            </defs>
            <rect width="${width}" height="${height}" rx="${radius}" fill="url(#shade)"/>
          </svg>`,
        ),
        blend: "over",
      },
    ])
    .png()
    .toBuffer();
}

function isBackgroundPixel(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return min >= 220 && max - min <= 35;
}

async function prepareGuest(width) {
  const { data, info } = await sharp(sources.guest)
    .rotate()
    .resize({ width, fit: "inside", withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width: w, height: h, channels } = info;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const enqueue = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const index = y * w + x;
    if (seen[index]) return;
    const offset = index * channels;
    if (!isBackgroundPixel(data[offset], data[offset + 1], data[offset + 2])) return;
    seen[index] = 1;
    queue[tail++] = index;
  };

  for (let x = 0; x < w; x += 1) {
    enqueue(x, 0);
    enqueue(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    enqueue(0, y);
    enqueue(w - 1, y);
  }

  while (head < tail) {
    const index = queue[head++];
    const x = index % w;
    const y = Math.floor(index / w);
    enqueue(x - 1, y);
    enqueue(x + 1, y);
    enqueue(x, y - 1);
    enqueue(x, y + 1);
  }

  const mask = Buffer.alloc(w * h);
  for (let i = 0; i < mask.length; i += 1) {
    mask[i] = seen[i] ? 0 : 255;
  }

  const { data: softenedMask, info: maskInfo } = await sharp(mask, {
    raw: { width: w, height: h, channels: 1 },
  })
    .blur(0.75)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const foreground = await sharp(data, { raw: info })
    .png()
    .toBuffer();

  const maskRgba = Buffer.alloc(w * h * 4, 255);
  for (let i = 0; i < w * h; i += 1) {
    maskRgba[i * 4 + 3] = softenedMask[i * maskInfo.channels];
  }
  const alphaMask = await sharp(maskRgba, {
    raw: { width: w, height: h, channels: 4 },
  })
    .png()
    .toBuffer();

  return sharp(foreground)
    .ensureAlpha()
    .composite([{ input: alphaMask, blend: "dest-in" }])
    .png()
    .toBuffer();
}

function posterOverlay({ width, height, layout }) {
  const {
    logoX,
    logoY,
    logoSize,
    titleTop,
    hostsX,
    hostsY,
    hostsW,
    hostsH,
    guestX,
    guestY,
    guestW,
    detailsY,
    detailsH,
  } = layout;

  const headlineSize = width >= 1080 ? 111 : 96;
  const secondHeadlineSize = width >= 1080 ? 103 : 92;
  const churchNameX = logoX + logoSize + 22;
  const churchNameY = logoY + 36;
  const hostLabelY = Math.min(detailsY - 54, hostsY + hostsH - 35);
  const guestLabelY = Math.min(detailsY - 70, guestY + guestW * 1.33);

  return svgBuffer(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="topShade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#04121E" stop-opacity=".62"/>
          <stop offset=".54" stop-color="#04121E" stop-opacity=".18"/>
          <stop offset="1" stop-color="#04121E" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="detailFill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#061827" stop-opacity=".98"/>
          <stop offset=".58" stop-color="#0A2437" stop-opacity=".98"/>
          <stop offset="1" stop-color="#061522" stop-opacity=".98"/>
        </linearGradient>
        <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="${palette.gold}" stop-opacity="0"/>
          <stop offset=".18" stop-color="${palette.gold}"/>
          <stop offset=".82" stop-color="${palette.gold}"/>
          <stop offset="1" stop-color="${palette.gold}" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="headlineGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FFF2C6"/>
          <stop offset=".48" stop-color="${palette.gold}"/>
          <stop offset="1" stop-color="#C89035"/>
        </linearGradient>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="#000A12" flood-opacity=".78"/>
        </filter>
        <filter id="softShadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#000A12" flood-opacity=".7"/>
        </filter>
        <filter id="guestGlow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="-2" dy="2" stdDeviation="5" flood-color="#F5C56A" flood-opacity=".5"/>
          <feDropShadow dx="0" dy="12" stdDeviation="12" flood-color="#000A12" flood-opacity=".8"/>
        </filter>
      </defs>

      <rect width="${width}" height="${Math.round(height * 0.54)}" fill="url(#topShade)"/>

      <rect x="${logoX - 10}" y="${logoY - 8}" width="${logoSize + 20}" height="${logoSize + 16}" rx="${Math.round(logoSize * 0.24)}"
        fill="#071C2C" fill-opacity=".82" stroke="${palette.gold}" stroke-opacity=".34"/>

      <g font-family="Avenir Next, Avenir, sans-serif">
        <text x="${churchNameX}" y="${churchNameY}" fill="${palette.white}" font-size="${Math.round(width * 0.027)}"
          font-weight="700" letter-spacing="${Math.round(width * 0.0028)}">RENEWED LIFE INTERNATIONAL</text>
        <text x="${churchNameX}" y="${churchNameY + 29}" fill="${palette.green}" font-size="${Math.round(width * 0.0145)}"
          font-weight="700" letter-spacing="${Math.round(width * 0.004)}">BELIEVE  •  BELONG  •  BECOME</text>

        <g transform="translate(0 ${titleTop})">
          <rect x="${Math.round(width * 0.38)}" y="0" width="${Math.round(width * 0.24)}" height="37" rx="18.5"
            fill="#08253A" fill-opacity=".86" stroke="${palette.gold}" stroke-opacity=".76"/>
          <text x="${width / 2}" y="25" text-anchor="middle" fill="${palette.cream}" font-size="${Math.round(width * 0.0175)}"
            font-weight="750" letter-spacing="${Math.round(width * 0.0045)}">SPECIAL SUNDAY</text>

          <text x="${width / 2}" y="133" text-anchor="middle" fill="${palette.white}" font-size="${headlineSize}"
            font-weight="800" letter-spacing="-2" filter="url(#shadow)">LOOKING</text>
          <text x="${width / 2}" y="231" text-anchor="middle" fill="url(#headlineGold)" font-size="${secondHeadlineSize}"
            font-weight="800" letter-spacing="-2" filter="url(#shadow)">UNTO JESUS</text>
          <rect x="${Math.round(width * 0.22)}" y="257" width="${Math.round(width * 0.56)}" height="2.5" fill="url(#goldLine)"/>
          <text x="${width / 2}" y="298" text-anchor="middle" fill="${palette.cream}" font-size="${Math.round(width * 0.021)}"
            font-weight="650" letter-spacing="${Math.round(width * 0.0027)}">WORSHIP  •  THE WORD  •  HOLY COMMUNION</text>
        </g>

        <rect x="${hostsX - 5}" y="${hostsY - 5}" width="${hostsW + 10}" height="${hostsH + 10}"
          rx="${layout.hostRadius + 5}" fill="none" stroke="${palette.gold}" stroke-width="3.5" filter="url(#softShadow)"/>

        <g filter="url(#softShadow)">
          <rect x="${hostsX + 24}" y="${hostLabelY - 32}" width="${Math.round(hostsW * 0.62)}" height="50" rx="25"
            fill="#061827" fill-opacity=".94" stroke="${palette.gold}" stroke-opacity=".85"/>
          <text x="${hostsX + 46}" y="${hostLabelY + 2}" fill="${palette.white}" font-size="${Math.round(width * 0.021)}"
            font-weight="800" letter-spacing="${Math.round(width * 0.0018)}">PST T &amp; Z NGWENYA</text>
        </g>

        <g filter="url(#guestGlow)">
          <rect x="${guestX + Math.round(guestW * 0.03)}" y="${guestLabelY - 38}" width="${Math.round(guestW * 0.94)}" height="75" rx="20"
            fill="#071A29" fill-opacity=".96" stroke="${palette.gold}" stroke-width="2"/>
          <text x="${guestX + guestW / 2}" y="${guestLabelY - 12}" text-anchor="middle" fill="${palette.gold}"
            font-size="${Math.round(width * 0.0138)}" font-weight="800" letter-spacing="${Math.round(width * 0.0027)}">GUEST WORSHIP MINISTER</text>
          <text x="${guestX + guestW / 2}" y="${guestLabelY + 19}" text-anchor="middle" fill="${palette.white}"
            font-size="${Math.round(width * 0.0235)}" font-weight="800">MINISTER GIFT ELISHA</text>
        </g>

        <g transform="translate(0 ${detailsY})">
          <rect width="${width}" height="${detailsH}" fill="url(#detailFill)"/>
          <rect width="${width}" height="3.5" fill="url(#goldLine)"/>

          <text x="${Math.round(width * 0.07)}" y="${Math.round(detailsH * 0.28)}" fill="${palette.gold}"
            font-size="${Math.round(width * 0.0205)}" font-weight="800" letter-spacing="${Math.round(width * 0.0025)}">SUNDAY • 2 AUGUST 2026</text>
          <text x="${Math.round(width * 0.93)}" y="${Math.round(detailsH * 0.28)}" text-anchor="end" fill="${palette.white}"
            font-size="${Math.round(width * 0.025)}" font-weight="800">10:00 AM – 1:00 PM</text>

          <rect x="${Math.round(width * 0.07)}" y="${Math.round(detailsH * 0.41)}" width="${Math.round(width * 0.86)}" height="1"
            fill="${palette.white}" fill-opacity=".16"/>

          <text x="${Math.round(width * 0.07)}" y="${Math.round(detailsH * 0.66)}" fill="${palette.white}"
            font-size="${Math.round(width * 0.031)}" font-weight="800" letter-spacing="${Math.round(width * 0.0015)}">MAMPURU HALL</text>
          <text x="${Math.round(width * 0.07)}" y="${Math.round(detailsH * 0.84)}" fill="${palette.cream}"
            font-size="${Math.round(width * 0.018)}" font-weight="600" letter-spacing="${Math.round(width * 0.0018)}">01621 SOBUZA STREET, DUBE</text>

          <text x="${Math.round(width * 0.93)}" y="${Math.round(detailsH * 0.73)}" text-anchor="end" fill="${palette.blue}"
            font-size="${Math.round(width * 0.016)}" font-weight="800" letter-spacing="${Math.round(width * 0.0032)}">#GREATERIMPACT</text>
        </g>
      </g>
    </svg>
  `);
}

async function generatePoster(config) {
  const {
    name,
    width,
    height,
    layout,
  } = config;

  const background = await sharp(sources.background)
    .resize({ width, height, fit: "cover", position: "center" })
    .modulate({ saturation: 0.94, brightness: 0.82 })
    .png()
    .toBuffer();

  const [logo, hosts, guest] = await Promise.all([
    prepareLogoMark(layout.logoSize),
    prepareHosts(layout.hostsW, layout.hostsH, layout.hostRadius),
    prepareGuest(layout.guestW),
  ]);

  const base = sharp(background).composite([
    {
      input: hosts,
      left: layout.hostsX,
      top: layout.hostsY,
    },
    {
      input: guest,
      left: layout.guestX,
      top: layout.guestY,
    },
    {
      input: logo,
      left: layout.logoX,
      top: layout.logoY,
    },
    {
      input: posterOverlay({ width, height, layout }),
      left: 0,
      top: 0,
    },
  ]);

  const pngPath = path.join(outputDir, `${name}.png`);
  const jpgPath = path.join(outputDir, `${name}.jpg`);

  await base.clone().png({ compressionLevel: 9 }).toFile(pngPath);
  await base.clone().jpeg({ quality: 94, chromaSubsampling: "4:4:4" }).toFile(jpgPath);

  return { pngPath, jpgPath };
}

await fs.mkdir(outputDir, { recursive: true });
await fs.copyFile(sources.background, path.join(outputDir, "generated-background.png"));

const outputs = [];

outputs.push(
  await generatePoster({
    name: "looking-unto-jesus-instagram-1080x1350",
    width: 1080,
    height: 1350,
    layout: {
      logoX: 44,
      logoY: 34,
      logoSize: 82,
      titleTop: 127,
      hostsX: 44,
      hostsY: 593,
      hostsW: 635,
      hostsH: 443,
      hostRadius: 38,
      guestX: 595,
      guestY: 525,
      guestW: 492,
      detailsY: 1130,
      detailsH: 220,
    },
  }),
);

outputs.push(
  await generatePoster({
    name: "looking-unto-jesus-story-1080x1920",
    width: 1080,
    height: 1920,
    layout: {
      logoX: 52,
      logoY: 54,
      logoSize: 92,
      titleTop: 174,
      hostsX: 42,
      hostsY: 742,
      hostsW: 696,
      hostsH: 488,
      hostRadius: 42,
      guestX: 579,
      guestY: 655,
      guestW: 540,
      detailsY: 1545,
      detailsH: 375,
    },
  }),
);

console.log(JSON.stringify(outputs, null, 2));
