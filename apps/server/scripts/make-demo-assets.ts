// Generates placeholder produce photos for demos and grading tests.
// Real produce photos are only needed when exercising GRADING_PROVIDER=hf live.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { REPO_ROOT } from '@ftm/core';

const outDir = path.join(REPO_ROOT, 'demo-assets');
fs.mkdirSync(outDir, { recursive: true });

const w = 1200;
const h = 900;

function texture(fill: (i: number) => [number, number, number]): Buffer {
  const buf = Buffer.alloc(w * h * 3);
  for (let i = 0; i < buf.length; i += 3) {
    const [r, g, b] = fill(i);
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  }
  return buf;
}

const golden = texture(() => {
  const v = 150 + Math.floor(Math.random() * 90);
  return [Math.min(255, v + 40), v, 40 + Math.floor(Math.random() * 40)];
});
const mouldy = texture(() => {
  const v = 60 + Math.floor(Math.random() * 80);
  return [v, Math.max(0, v - 10), 30];
});

await sharp(golden, { raw: { width: w, height: h, channels: 3 } })
  .jpeg({ quality: 90 })
  .toFile(path.join(outDir, 'maize-good.jpg'));
await sharp(mouldy, { raw: { width: w, height: h, channels: 3 } })
  .jpeg({ quality: 90 })
  .toFile(path.join(outDir, 'maize-mouldy.jpg'));

console.log(`assets written to ${outDir}`);
