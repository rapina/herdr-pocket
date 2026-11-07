import { mkdirSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { adb } from './android.mjs';
mkdirSync('artifacts', { recursive: true });
const display = process.env.ANDROID_DISPLAY_ID;
const output = adb(['exec-out', 'screencap', ...(display ? ['-d', display] : []), '-p']);
if (output.readUInt32BE(0) !== 0x89504e47)
  throw Error(
    'No PNG returned. Set ANDROID_DISPLAY_ID from adb shell dumpsys SurfaceFlinger --display-id.',
  );
writeFileSync(`artifacts/${basename(process.argv[2] || 'phone')}.png`, output);
