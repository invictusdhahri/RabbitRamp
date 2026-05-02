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

/** Render a rounded-rect with a minimal rabbit silhouette + soft glow halo */
function renderIcon(size) {
  const pixels = new Uint8Array(size * size * 4);

  const radius = size * 0.22;

  // Background: deep navy #0a0e20
  const bgR = 0x0a, bgG = 0x0e, bgB = 0x20;
  // Rabbit: bright sky-blue #7dd3fc
  const rabR = 0x7d, rabG = 0xd3, rabB = 0xfc;
  // Glow: slightly desaturated version of rabbit
  const glowR = 0x3b, glowG = 0x82, glowB = 0xf6;
  // Glow halo radius in normalised units
  const glowHalo = 0.072;

  // Pre-compute nearest-rabbit distance field at low resolution for glow
  // We sample the glow at each pixel by computing min-distance to rabbit surface
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;

      const inRect = isInRoundedRect(x, y, 0, 0, size, size, radius);

      if (!inRect) {
        pixels[idx + 3] = 0;
        continue;
      }

      const nx = (x + 0.5) / size;
      const ny = (y + 0.5) / size;
      const isRabbit = isRabbitPixel(x, y, size);

      if (isRabbit) {
        pixels[idx]     = rabR;
        pixels[idx + 1] = rabG;
        pixels[idx + 2] = rabB;
        pixels[idx + 3] = 255;
      } else {
        // Check proximity to rabbit for glow effect (sample 8 nearby pixels)
        let nearestDist = Infinity;
        const step = glowHalo / 3;
        for (let dy = -glowHalo; dy <= glowHalo; dy += step) {
          for (let dx = -glowHalo; dx <= glowHalo; dx += step) {
            if (dx === 0 && dy === 0) continue;
            const sx = Math.round((nx + dx) * size - 0.5);
            const sy = Math.round((ny + dy) * size - 0.5);
            if (sx >= 0 && sx < size && sy >= 0 && sy < size) {
              if (isRabbitPixel(sx, sy, size)) {
                const d = Math.hypot(dx, dy);
                if (d < nearestDist) nearestDist = d;
              }
            }
          }
        }

        if (nearestDist < glowHalo) {
          // Blend background toward glow color
          const t = Math.pow(1 - nearestDist / glowHalo, 2) * 0.45;
          pixels[idx]     = lerp(bgR, glowR, t);
          pixels[idx + 1] = lerp(bgG, glowG, t);
          pixels[idx + 2] = lerp(bgB, glowB, t);
        } else {
          pixels[idx]     = bgR;
          pixels[idx + 1] = bgG;
          pixels[idx + 2] = bgB;
        }
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

/**
 * Minimal rabbit mark in normalised [0,1] space:
 *   - Two narrow upright ears (left & right)
 *   - A circular head
 *   - A slightly larger elliptical body below
 * All drawn via distance-field checks for crispness at any size.
 */
function isRabbitPixel(px, py, size) {
  const nx = (px + 0.5) / size;
  const ny = (py + 0.5) / size;

  const stroke = 0.065;        // ear stroke half-width
  const earH   = 0.30;         // ear height (normalised)
  const earW   = stroke;

  // Left ear  — centre x=0.38, top y=0.08, bottom y=0.08+earH
  const leftEarX  = 0.38;
  const rightEarX = 0.62;
  const earTopY   = 0.07;
  const earBotY   = earTopY + earH;

  const dLE = distToSegment(nx, ny, leftEarX,  earTopY, leftEarX,  earBotY);
  const dRE = distToSegment(nx, ny, rightEarX, earTopY, rightEarX, earBotY);
  if (dLE < earW || dRE < earW) return true;

  // Head — circle centred at (0.50, 0.52), radius 0.17
  const hx = 0.50, hy = 0.52, hr = 0.175;
  const dHead = Math.hypot(nx - hx, ny - hy);
  if (dHead < hr) return true;

  // Body — ellipse centred at (0.50, 0.76), rx=0.21, ry=0.17
  const bx = 0.50, by = 0.76, brx = 0.21, bry = 0.17;
  const dBody = Math.hypot((nx - bx) / brx, (ny - by) / bry);
  if (dBody < 1) return true;

  return false;
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
