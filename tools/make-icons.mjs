// Generates src/assets/icon-192.png and icon-512.png with no dependencies (raw PNG encoder via zlib).
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; for (let x = 0; x < size; x++) { const [r, g, b, a] = pixel(x, y); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; } }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const STARS = [[0.32, 0.36, 0.05], [0.62, 0.26, 0.04], [0.72, 0.58, 0.06], [0.46, 0.70, 0.045], [0.24, 0.62, 0.03], [0.55, 0.47, 0.03]];
const LINES = [[0, 1], [1, 2], [2, 3], [3, 0], [3, 4]];
function make(size) {
  const r = size * 0.22;
  const px = (x, y) => {
    const u = x / size, v = y / size;
    // rounded square mask
    const dx = Math.max(Math.abs(x - size / 2) - (size / 2 - r), 0), dy = Math.max(Math.abs(y - size / 2) - (size / 2 - r), 0);
    if (Math.hypot(dx, dy) > r) return [0, 0, 0, 0];
    let col = [8 + 20 * v, 12 + 24 * v, 32 + 40 * v];
    for (const [a, b] of LINES) { const [x1, y1] = STARS[a], [x2, y2] = STARS[b]; const d = distSeg(u, v, x1, y1, x2, y2); if (d < 0.012) col = [90, 140, 230]; }
    for (const [sx, sy, sr] of STARS) { const d = Math.hypot(u - sx, v - sy); if (d < sr) { const k = 1 - d / sr; col = [col[0] + (255 - col[0]) * k, col[1] + (250 - col[1]) * k, col[2] + (240 - col[2]) * k]; } }
    return [col[0] | 0, col[1] | 0, col[2] | 0, 255];
  };
  return png(size, px);
}
function distSeg(px, py, x1, y1, x2, y2) { const l2 = (x2 - x1) ** 2 + (y2 - y1) ** 2; let t = ((px - x1) * (x2 - x1) + (py - y1) * (y2 - y1)) / l2; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (x1 + t * (x2 - x1)), py - (y1 + t * (y2 - y1))); }
const out = fileURLToPath(new URL("../src/assets/", import.meta.url));
for (const s of [192, 512]) { writeFileSync(out + `icon-${s}.png`, make(s)); console.log(`icon-${s}.png`); }
