/**
 * Pure Node.js icon generator — no external dependencies.
 * Creates CoursCheat PNG icons at 16, 32, 48, 128px.
 */
import { writeFileSync } from "fs";
import { deflateSync } from "zlib";

function u32(n) {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function crc32(buf) {
  let crc = 0xffffffff;
  const table = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, "ascii");
  const len = u32(data.length);
  const crcData = Buffer.concat([typeBytes, data]);
  const crc = u32(crc32(crcData));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function makePNG(pixels, width, height) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.concat([u32(width), u32(height), Buffer.from([8, 2, 0, 0, 0])]);

  // Build raw scanlines (filter byte 0 + RGB triplets)
  const raw = Buffer.allocUnsafe(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0; // filter type None
    for (let x = 0; x < width; x++) {
      const pi = (y * width + x) * 4;
      const ri = y * (1 + width * 3) + 1 + x * 3;
      raw[ri] = pixels[pi];
      raw[ri + 1] = pixels[pi + 1];
      raw[ri + 2] = pixels[pi + 2];
    }
  }

  const idat = deflateSync(raw);
  const iend = Buffer.alloc(0);

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", iend),
  ]);
}

/** Render a solid rounded-rect with a lightning symbol */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  const radius = size * 0.18;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      // Rounded rectangle check
      const inRect = isInRoundedRect(x, y, 0, 0, size, size, radius);

      if (!inRect) {
        pixels[idx + 3] = 0; // transparent
        continue;
      }

      // Background gradient: dark indigo #1e1b4b → #312e81
      const t = (x + y) / (size * 2);
      pixels[idx] = lerp(0x1e, 0x31, t);
      pixels[idx + 1] = lerp(0x1b, 0x2e, t);
      pixels[idx + 2] = lerp(0x4b, 0x81, t);
      pixels[idx + 3] = 255;

      // Lightning bolt drawn as pixels
      if (isLightningPixel(x, y, size)) {
        // Soft lavender #a78bfa
        pixels[idx] = 0xa7;
        pixels[idx + 1] = 0x8b;
        pixels[idx + 2] = 0xfa;
        pixels[idx + 3] = 255;
      }
    }
  }

  return pixels;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function isInRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px >= x + w || py < y || py >= y + h) return false;
  // Corners
  const corners = [
    [x + r, y + r],
    [x + w - r, y + r],
    [x + r, y + h - r],
    [x + w - r, y + h - r],
  ];
  for (const [cx, cy] of corners) {
    if (px >= cx - r && px <= cx + r && py >= cy - r && py <= cy + r) {
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy > r * r) return false;
    }
  }
  return true;
}

function isLightningPixel(px, py, size) {
  // Normalise to 0..1
  const nx = px / size;
  const ny = py / size;

  // Lightning bolt polygon (normalised coordinates)
  // Top part: upper-right slanting down to middle-left
  // Bottom part: middle-right slanting down to lower-left
  const boldness = 0.13;

  // Upper bolt: (0.62, 0.08) → (0.36, 0.50)
  const d1 = distToSegment(nx, ny, 0.62, 0.08, 0.36, 0.50);
  // Lower bolt: (0.64, 0.50) → (0.38, 0.92)
  const d2 = distToSegment(nx, ny, 0.64, 0.50, 0.38, 0.92);

  return d1 < boldness || d2 < boldness;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

for (const size of [16, 32, 48, 128]) {
  const pixels = renderIcon(size);
  const png = makePNG(pixels, size, size);
  writeFileSync(`icons/icon${size}.png`, png);
  console.log(`Generated icons/icon${size}.png (${png.length} bytes)`);
}
