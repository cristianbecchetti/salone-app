// Genera public/icon-192.png e public/icon-512.png (forbici bianche su fondo prugna)
// senza dipendenze esterne. Uso: npm run icons
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const distSeg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
// true se il punto (0..1, 0..1) fa parte del disegno bianco
const forbici = (x, y) => {
  const anello = (cx, cy) => {
    const d = Math.hypot(x - cx, y - cy);
    return d < 0.1 && d > 0.058;
  };
  return (
    anello(0.36, 0.7) ||
    anello(0.64, 0.7) ||
    distSeg(x, y, 0.41, 0.62, 0.66, 0.2) < 0.024 ||
    distSeg(x, y, 0.59, 0.62, 0.34, 0.2) < 0.024
  );
};

const BG = [0x6d, 0x3b, 0x5e];
function png(size) {
  const riga = size * 4 + 1;
  const raw = Buffer.alloc(riga * size);
  const S = 3; // supersampling per bordi morbidi
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let dentro = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++)
          if (forbici((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size)) dentro++;
      const k = dentro / (S * S);
      const o = y * riga + 1 + x * 4;
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round(BG[i] + (255 - BG[i]) * k);
      raw[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const s of [192, 512]) {
  writeFileSync(join(out, `icon-${s}.png`), png(s));
  console.log(`icon-${s}.png creato`);
}
