// The home-screen icon: 512 x 512, the page's dark background edge to edge, a rising line in the accent blue
// inside the central 80% safe zone, no words. Rebuild it with: node tests/icon.mjs (writes icon.png).
// The deflate stream is written here (fixed Huffman codes, runs as distance-1 matches), not by zlib, so the bytes are
// the same on every Node version; tests/static.mjs checks the committed icon.png equals iconBytes().
import {writeFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const W = 512, LEVELS = 16, BG = [0x16, 0x19, 0x1f], FG = [0x5b, 0x9d, 0xff];
const linePts = [[118, 360], [210, 268], [280, 318], [394, 162]], HALF = 17; // all inside 51..461 (the 80% zone)

function pixels() { // one palette index per pixel: 0 is the background, LEVELS - 1 the full line colour
  const out = new Uint8Array(W * W);
  for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
    let d = 1e9;
    for (let i = 1; i < linePts.length; i++) {
      const [ax, ay] = linePts[i - 1], [bx, by] = linePts[i], dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / (dx * dx + dy * dy)));
      d = Math.min(d, Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy));
    }
    out[y * W + x] = Math.round(Math.max(0, Math.min(1, HALF + 0.5 - d)) * (LEVELS - 1));
  }
  return out;
}

function deflate(data) { // zlib header, one final fixed-Huffman block, adler32
  const bytes = [0x78, 0x01];
  let acc = 0, n = 0;
  const bits = (v, k) => { acc |= v << n; n += k; while (n >= 8) { bytes.push(acc & 255); acc >>>= 8; n -= 8; } };
  const huff = (code, k) => { let r = 0; for (let i = 0; i < k; i++) r |= ((code >> i) & 1) << (k - 1 - i); bits(r, k); };
  const lit = v => v < 144 ? huff(0x30 + v, 8) : v < 256 ? huff(0x190 + v - 144, 9) : v < 280 ? huff(v - 256, 7) : huff(0xc0 + v - 280, 8);
  const lenBase = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const lenExtra = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const match = len => { // distance 1: repeat the previous byte
    let i = lenBase.length - 1; while (lenBase[i] > len) i--;
    lit(257 + i); if (lenExtra[i]) bits(len - lenBase[i], lenExtra[i]);
    huff(0, 5);
  };
  bits(1, 1); bits(1, 2);
  for (let i = 0; i < data.length;) {
    let j = i + 1; while (j < data.length && data[j] === data[i] && j - i < 259) j++;
    lit(data[i]);
    let run = j - i - 1;
    while (run >= 3) { const l = Math.min(run, 258); match(l); run -= l; }
    while (run-- > 0) lit(data[i]);
    i = j;
  }
  lit(256);
  if (n) bytes.push(acc & 255);
  let a = 1, b = 0;
  for (const v of data) { a = (a + v) % 65521; b = (b + a) % 65521; }
  bytes.push(b >> 8, b & 255, a >> 8, a & 255);
  return Buffer.from(bytes);
}

const CRC = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function chunk(type, body) {
  const t = Buffer.from(type, "latin1"), len = Buffer.alloc(4), crc = Buffer.alloc(4);
  let c = 0xffffffff; for (const v of Buffer.concat([t, body])) c = CRC[(c ^ v) & 255] ^ (c >>> 8);
  len.writeUInt32BE(body.length); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, t, body, crc]);
}

export function iconBytes() {
  const px = pixels(), raw = new Uint8Array(W * (W + 1));
  for (let y = 0; y < W; y++) raw.set(px.subarray(y * W, y * W + W), y * (W + 1) + 1); // filter byte 0 per row
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 3; // 8-bit palette
  const plte = Buffer.from(Array.from({length: LEVELS}, (_, i) => BG.map((v, k) => Math.round(v + (FG[k] - v) * i / (LEVELS - 1)))).flat());
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("PLTE", plte),
    chunk("IDAT", deflate(raw)), chunk("IEND", Buffer.alloc(0))]);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const b = iconBytes();
  writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "icon.png"), b);
  console.log("wrote icon.png (" + b.length + " bytes)");
}
