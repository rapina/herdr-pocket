import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
export function adbPath() {
  if (process.env.ADB_PATH) return process.env.ADB_PATH;
  const sdk =
    process.env.ANDROID_HOME ||
    process.env.ANDROID_SDK_ROOT ||
    (process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'));
  const candidate =
    sdk && join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
  return candidate && existsSync(candidate) ? candidate : 'adb';
}
export function adb(args) {
  return execFileSync(adbPath(), args, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
}
