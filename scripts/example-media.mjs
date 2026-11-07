import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const folder = resolve(import.meta.dirname, '../docs/examples');
mkdirSync(folder, { recursive: true });
const width = 640,
  height = 360,
  fps = 24,
  seconds = 4;
const background = [11, 18, 27],
  cyan = [79, 225, 218],
  yellow = [244, 239, 25];
function frame(time) {
  const pixels = Buffer.alloc(width * height * 3);
  const angle = (time * Math.PI) / 2;
  const dots = [0, 2.1, 4.2].map((offset, i) => ({
    x: width / 2 + Math.cos(angle + offset) * (80 + i * 35),
    y: height / 2 + Math.sin(angle + offset) * (42 + i * 23),
  }));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - width / 2,
        dy = y - height / 2;
      const radius = Math.hypot(dx, dy * 1.7);
      let color = background;
      if (x % 40 === 0 || y % 40 === 0) color = [23, 39, 49];
      if ([80, 115, 150].some((r) => Math.abs(radius - r) < 1.4)) color = [35, 102, 111];
      if (Math.hypot(dx, dy) < 16) color = yellow;
      if (dots.some((dot) => Math.hypot(x - dot.x, y - dot.y) < 7)) color = cyan;
      if ((x > 24 && x < 76 && y > 24 && y < 28) || (x > 564 && x < 616 && y > 332 && y < 336))
        color = yellow;
      const offset = (y * width + x) * 3;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
    }
  }
  return pixels;
}
const raw = [
  '-f',
  'rawvideo',
  '-pixel_format',
  'rgb24',
  '-video_size',
  `${width}x${height}`,
  '-framerate',
  String(fps),
  '-i',
  'pipe:0',
];
function encode(args, input) {
  execFileSync(
    process.env.FFMPEG_BIN || 'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', ...raw, ...args],
    { input, windowsHide: true },
  );
}
encode(['-frames:v', '1', '-map_metadata', '-1', resolve(folder, 'orbit-study.png')], frame(0));
encode(
  [
    '-an',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '23',
    '-movflags',
    '+faststart',
    '-map_metadata',
    '-1',
    '-metadata',
    'encoder=',
    resolve(folder, 'orbit-loop.mp4'),
  ],
  Buffer.concat(Array.from({ length: fps * seconds }, (_, i) => frame(i / fps))),
);

const rate = 22050,
  samples = rate * 2;
const audio = Buffer.alloc(44 + samples * 2);
audio.write('RIFF');
audio.writeUInt32LE(audio.length - 8, 4);
audio.write('WAVEfmt ', 8);
audio.writeUInt32LE(16, 16);
audio.writeUInt16LE(1, 20);
audio.writeUInt16LE(1, 22);
audio.writeUInt32LE(rate, 24);
audio.writeUInt32LE(rate * 2, 28);
audio.writeUInt16LE(2, 32);
audio.writeUInt16LE(16, 34);
audio.write('data', 36);
audio.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  let value = 0;
  for (const [start, frequency] of [
    [0, 523.25],
    [0.23, 659.25],
    [0.46, 783.99],
  ]) {
    const elapsed = t - start;
    if (elapsed >= 0)
      value +=
        Math.sin(2 * Math.PI * frequency * elapsed) *
        Math.min(1, elapsed / 0.015) *
        Math.exp(-5 * elapsed) *
        0.16;
  }
  audio.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}
writeFileSync(resolve(folder, 'completion-chime.wav'), audio);
console.log('Generated an original orbit image, four-second loop, and two-second chime.');
