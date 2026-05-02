/**
 * Generates RabbitRamp PNG icons at 16, 32, 48, 128px
 * by resizing assets/icon-source.png using sharp.
 *
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from "sharp";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "assets", "icon-source.png");
const outDir = resolve(root, "icons");

mkdirSync(outDir, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const dest = resolve(outDir, `icon${size}.png`);
  await sharp(src)
    .resize(size, size, { fit: "cover", position: "centre" })
    .png()
    .toFile(dest);
  console.log(`✓ icons/icon${size}.png`);
}
