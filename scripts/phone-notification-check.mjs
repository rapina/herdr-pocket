import { connect } from './phone-cdp.mjs';
import { adb } from './android.mjs';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const c = await connect(),
  checks = [];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, value) => {
  checks.push({ name, value });
  if (!value) throw Error(name);
};
function fixture(key, mode, kind = 'input', at = Date.now()) {
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
    '--el',
    'at',
    String(at),
  ]).toString();
  const match = output.match(/data="(\{.*\})"/);
  if (!match) throw Error(output);
  return JSON.parse(match[1].replaceAll('\\"', '"'));
}
async function post(key, kind = 'input', at = Date.now()) {
  fixture(key, 'show', kind, at);
  await wait(200);
  return fixture(key, 'inspect', 'invalid');
}
let target;
const secondaryKey = randomUUID();
try {
  for (let i = 0; i < 80; i++) {
    if (await c.evaluate(`!!state.snapshot?.terminals.some(t=>t.notificationKey)`)) break;
    await wait(200);
  }
  target = await c.evaluate(
    `(()=>{const t=state.snapshot.terminals.find(t=>t.notificationKey);return {address:t.address,key:t.notificationKey}})()`,
  );
  await c.evaluate(`openDetail(${JSON.stringify(target.address)})`);
  for (let i = 0; i < 50; i++) {
    if (await c.evaluate(`!!state.detail?.terminal.notificationKey`)) break;
    await wait(200);
  }
  await c.evaluate(`syncPushContext()`);
  await wait(150);
  check('foreground session suppresses notification', fixture(target.key, 'show').count === 0);
  adb(['shell', 'input', 'keyevent', 'KEYCODE_HOME']);
  await wait(250);
  const at = Date.now();
  const input = await post(target.key, 'input', at);
  check(
    'background input notification is high importance',
    input.count === 1 && input.channel === 'pocket_input' && input.importance === 4,
  );
  check('multiple sessions create a notification group', (await post(secondaryKey)).groupSummary);
  fixture(secondaryKey, 'clear');
  await wait(200);
  check(
    'removing one session preserves the other notification',
    fixture(target.key, 'inspect', 'invalid').count === 1,
  );
  const duplicate = await post(target.key, 'error', at);
  check(
    'duplicate timestamp cannot replace the notification',
    duplicate.channel === 'pocket_input' && duplicate.when === at,
  );
  const done = await post(target.key, 'done', Date.now());
  check(
    'completion replaces the session notification silently',
    done.count === 1 && done.channel === 'pocket_done' && done.importance === 2 && !done.sound,
  );
  adb(['shell', 'am', 'start', '-n', 'dev.rapina.herdrpocket/.MainActivity']);
  await wait(350);
  await c.evaluate(`closeDetail()`);
  await wait(150);
  // Opening the foreground session cancels its old notification; issue a fresh one from the list.
  await post(target.key, 'done');
  fixture(target.key, 'tap');
  for (let i = 0; i < 80; i++) {
    if (
      await c.evaluate(
        `state.selected===${JSON.stringify(target.address)}&&queuedNotification===null`,
      )
    )
      break;
    await wait(200);
  }
  check(
    'notification PendingIntent opens the matching chat',
    await c.evaluate(
      `state.selected===${JSON.stringify(target.address)}&&queuedNotification===null`,
    ),
  );
  await c.evaluate(`closeDetail();state.tab='settings';render()`);
  await wait(200);
  check(
    'unconfigured Firebase stays disabled',
    await c.evaluate(
      `!state.config.push.enabled&&$('push-state').textContent===tr('push_disabled')`,
    ),
  );
  await c.evaluate(`$('push-toggle').click()`);
  for (let i = 0; i < 80; i++) {
    if (await c.evaluate(`!pushBusy`)) break;
    await wait(200);
  }
  check(
    'enable reports missing bridge Firebase configuration',
    await c.evaluate(
      `$('toast').textContent===tr('push_not_configured')&&!state.config.push.enabled`,
    ),
  );
  const screenshot = await c.command('Page.captureScreenshot', { format: 'png' });
  writeFileSync('artifacts/phone-push-settings.png', Buffer.from(screenshot.data, 'base64'));
  console.log(JSON.stringify(checks));
  writeFileSync('artifacts/phone-push-checks.json', JSON.stringify(checks, null, 2));
} finally {
  if (target) fixture(target.key, 'clear');
  fixture(secondaryKey, 'clear');
  c.close();
}
