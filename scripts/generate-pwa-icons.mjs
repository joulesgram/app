/**
 * Generate PWA icon PNGs from SVG sources.
 *
 * Usage:
 *   npm install --save-dev sharp   # one-time
 *   node scripts/generate-pwa-icons.mjs
 *
 * Produces 192x192 and 512x512 PNGs for both regular and maskable icons.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = join(__dirname, "..", "public", "icons");

async function generate() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "sharp is not installed. Run: npm install --save-dev sharp\nThen re-run this script."
    );
    process.exit(1);
  }

  const variants = [
    { src: "icon.svg", prefix: "icon" },
    { src: "icon-maskable.svg", prefix: "icon-maskable" },
  ];
  const sizes = [192, 512];

  for (const { src, prefix } of variants) {
    const svgBuffer = readFileSync(join(iconsDir, src));
    for (const size of sizes) {
      const outPath = join(iconsDir, `${prefix}-${size}x${size}.png`);
      await sharp(svgBuffer)
        .resize(size, size)
        .png()
        .toFile(outPath);
      console.log(`  Created ${outPath}`);
    }
  }

  // Also create favicon.ico (48x48 PNG used as favicon)
  const svgBuffer = readFileSync(join(iconsDir, "icon.svg"));
  await sharp(svgBuffer)
    .resize(48, 48)
    .png()
    .toFile(join(iconsDir, "..", "favicon.png"));
  console.log(`  Created public/favicon.png`);

  console.log("\nDone! PWA icons generated successfully.");
}

generate();
