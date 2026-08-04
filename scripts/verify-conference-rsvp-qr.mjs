import path from "node:path";
import sharp from "sharp";

const projectRoot = "/Users/thabangngwenya/Development/Projects/sermon_clip";
const outputDir = path.join(
  projectRoot,
  "design",
  "conference-crowned-rsvp",
);
const standaloneQrPath = path.join(outputDir, "conference-rsvp-qr.png");
const posterPaths = [
  path.join(outputDir, "crowned-conference-rsvp-qr-poster.png"),
  path.join(outputDir, "crowned-conference-rsvp-qr-poster.jpg"),
];

const totalModules = 61;
const posterQrSize = 244;
const moduleScale = posterQrSize / totalModules;
if (!Number.isInteger(moduleScale)) {
  throw new Error("Poster QR modules do not map to whole pixels.");
}

const posterWidth = 1024;
const cardWidth = posterQrSize + 30;
const cardX = posterWidth - cardWidth - 18;
const cardY = 18;
const qrX = cardX + 15;
const qrY = cardY + 61;

const expected = await sharp(standaloneQrPath)
  .resize({
    width: posterQrSize,
    height: posterQrSize,
    kernel: sharp.kernel.nearest,
    fit: "fill",
  })
  .removeAlpha()
  .raw()
  .toBuffer();

function isDark(buffer, x, y) {
  const offset = (y * posterQrSize + x) * 3;
  const luminance =
    buffer[offset] * 0.2126 +
    buffer[offset + 1] * 0.7152 +
    buffer[offset + 2] * 0.0722;
  return luminance < 128;
}

for (const posterPath of posterPaths) {
  const crop = await sharp(posterPath)
    .extract({
      left: qrX,
      top: qrY,
      width: posterQrSize,
      height: posterQrSize,
    })
    .removeAlpha()
    .raw()
    .toBuffer();

  let moduleMismatches = 0;
  for (let moduleY = 0; moduleY < totalModules; moduleY += 1) {
    for (let moduleX = 0; moduleX < totalModules; moduleX += 1) {
      const sampleX = moduleX * moduleScale + Math.floor(moduleScale / 2);
      const sampleY = moduleY * moduleScale + Math.floor(moduleScale / 2);
      if (
        isDark(expected, sampleX, sampleY) !==
        isDark(crop, sampleX, sampleY)
      ) {
        moduleMismatches += 1;
      }
    }
  }

  if (moduleMismatches !== 0) {
    throw new Error(
      `${path.basename(posterPath)} altered ${moduleMismatches} QR modules.`,
    );
  }
  console.log(`${path.basename(posterPath)}: all ${totalModules ** 2} modules verified`);
}
