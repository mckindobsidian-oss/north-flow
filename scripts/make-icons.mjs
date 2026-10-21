/**
 * NORTH — extension icon generator (build-time asset, no runtime dependency).
 *
 * `apps/extension/background.js` shows focus notifications with
 * `chrome.runtime.getURL("icon128.png")`, and `manifest.json` declares the
 * toolbar icon. Neither file existed, so Chrome drew its own placeholder and
 * the notification path had to swallow the failure. Shipping a stray binary
 * nobody can regenerate is worse than shipping the recipe, so the icons are
 * generated here — deterministic, reviewable, and reproducible with:
 *
 *     node scripts/make-icons.mjs
 *
 * Drawing: the same mark the app uses for its brand tile — a rounded dark
 * square carrying an accent ring with a filled centre (the Compass glyph).
 * Anti-aliasing comes from 4×4 supersampling; the encoder is ~60 lines of
 * zlib + CRC32 so this needs no image library.
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "apps", "extension", "icons");

// Brand colours, taken from the app's default environment (Event Horizon).
const BG = [11, 12, 16];       // #0B0C10 — the app's dark chrome
const ACC = [240, 182, 90];    // #F0B65A — Event Horizon's accent

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling factor per axis

/** Render one icon as raw RGBA rows. */
function render(size) {
  const rows = [];
  const c = (size - 1) / 2;
  const radius = size * 0.225;      // rounded-square corner radius
  const ringOuter = size * 0.325;   // accent ring
  const ringInner = size * 0.225;
  const dot = size * 0.105;         // centre dot
  for (let y = 0; y < size; y++) {
    const row = [];
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const inSquare = insideRoundedRect(px, py, size, radius);
          if (!inSquare) continue;                       // transparent corner
          const d = Math.hypot(px - (c + 0.5), py - (c + 0.5));
          const isRing = d >= ringInner && d <= ringOuter;
          const isDot = d <= dot;
          const col = isRing || isDot ? ACC : BG;
          r += col[0]; g += col[1]; b += col[2]; a += 255;
        }
      }
      const n = SS * SS;
      row.push(
        a === 0 ? 0 : Math.round(r / (a / 255)),
        a === 0 ? 0 : Math.round(g / (a / 255)),
        a === 0 ? 0 : Math.round(b / (a / 255)),
        Math.round(a / n),
      );
    }
    rows.push(row);
  }
  return rows;
}

/** Is (x,y) inside a square of `size` with rounded corners of `radius`? */
function insideRoundedRect(x, y, size, radius) {
  const clamp = (v) => Math.min(Math.max(v, radius), size - radius);
  const dx = x - clamp(x);
  const dy = y - clamp(y);
  return dx * dx + dy * dy <= radius * radius;
}

/** Minimal PNG encoder: 8-bit RGBA, no interlacing. */
function png(rows) {
  const w = rows[0].length / 4;
  const h = rows.length;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  rows.forEach((row, y) => {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    Buffer.from(row).copy(raw, y * (w * 4 + 1) + 1);
  });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT, `icon${size}.png`);
  const bytes = png(render(size));
  writeFileSync(file, bytes);
  console.log(`wrote ${file} (${bytes.length} bytes)`);
}
