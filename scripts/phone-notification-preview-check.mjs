import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { adb } from './android.mjs';
import { createFcmSender, loadPushConfig, notificationPreview } from '../bridge/push.mjs';

const folder = resolve(import.meta.dirname, '../.local');
const key = randomUUID();
function fixture(mode, kind = 'invalid') {
  const output = adb([
    'shell',
    'am',
    'broadcast',
    '-n',
    'dev.rapina.herdrpocket/.PushFixtureReceiver',
    '--es',
    'key',
    key,
    '--es',
    'mode',
    mode,
    '--es',
    'kind',
    kind,
  ]).toString();
  const match = output.match(/data="(\{.*\})"/);
  assert.ok(match, 'Notification fixture must be available in the installed debug APK');
  return JSON.parse(match[1].replaceAll('\\"', '"'));
}

const preferences = adb([
  'shell',
  'run-as',
  'dev.rapina.herdrpocket',
  'cat',
  'shared_prefs/push.xml',
]).toString();
const deviceId = preferences.match(/<string name="id">([^<]+)<\/string>/)?.[1];
const state = JSON.parse(readFileSync(resolve(folder, 'push-state.json'), 'utf8'));
assert.ok(
  deviceId && state.devices[deviceId],
  'Connected phone must be registered with this bridge',
);
const config = loadPushConfig(folder);
assert.ok(config, 'Firebase must be configured');
const sender = createFcmSender(config);
const preview = notificationPreview(
  '알림 미리보기 확인 😀\n응답 내용을 펼쳐서 읽을 수 있습니다.\n' +
    '긴 응답 내용입니다. '.repeat(160),
);
try {
  const fallback = fixture('show', 'done');
  assert.equal(fallback.count, 1);
  assert.ok(['응답이 도착했어요', 'Response ready'].includes(fallback.text));
  fixture('clear');
  const at = Date.now();
  await sender(state.devices[deviceId].token, { id: randomUUID(), key, kind: 'done', at, preview });
  let observed;
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((r) => setTimeout(r, 1000));
    observed = fixture('inspect');
    if (observed.count === 1 && observed.when === at) break;
  }
  assert.equal(observed?.count, 1, 'Real FCM notification did not arrive');
  assert.equal(observed.when, at);
  assert.equal(observed.text, preview);
  assert.equal(observed.bigText, preview);
  assert.equal(observed.channel, 'pocket_done');
  assert.equal(observed.sound, false);
  console.log(
    JSON.stringify({
      realFcm: true,
      preview: true,
      expandedText: true,
      unicode: true,
      fallback: true,
      silent: true,
    }),
  );
} finally {
  fixture('clear');
}
