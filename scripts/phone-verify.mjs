import assert from 'node:assert/strict';
import { connect } from './phone-cdp.mjs';
import { createHc } from '../bridge/server.mjs';
const c = await connect();
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const r = await c.evaluate(expression);
    if (r) return r;
    await pause(500);
  }
  throw new Error(`Timed out: ${expression}`);
}
try {
  const mode = process.argv[2] || 'read';
  await c.evaluate("state.tab='tasks';render();refresh()");
  await until('state.online && state.snapshot?.terminals.length > 0');
  const snapshot = await c.evaluate(
    `({count:state.snapshot.terminals.length,machines:state.snapshot.machines.length,overflow:document.documentElement.scrollWidth>innerWidth,errors:state.error})`,
  );
  assert.equal(snapshot.overflow, false);
  console.log('LIVE SNAPSHOT', snapshot);
  if (mode === 'send') {
    const address = process.argv[3];
    if (!address) throw Error('Pass the dedicated echo fixture address');
    await c.evaluate(`openDetail(${JSON.stringify(address)})`);
    await until(`state.detail?.terminal.name==='pocket-test' && state.detail.canSend`);
    const phrase = 'Pocket phone test ' + new Date().toISOString();
    await c.evaluate(
      `$('message-input').value=${JSON.stringify(phrase)};$('message-input').dispatchEvent(new Event('input'));$('send-message').click()`,
    );
    await until('!pendingMessage && !state.sendBusy', 35000);
    const output = await createHc()('read', address, '--json', '--lines', '20');
    assert.ok(output.text.includes('POCKET_RECEIVED: ' + phrase));
    assert.equal(await c.evaluate(`$('message-input').value`), '');
    console.log('PHONE SEND VERIFIED: dedicated echo terminal received one message.');
  } else {
    await c.evaluate("state.tab='devices';render()");
    assert.ok(await c.evaluate(`document.querySelectorAll('.machine-row').length>=1`));
    await c.evaluate("state.tab='tasks';render()");
    console.log('DEVICES VERIFIED');
  }
} finally {
  c.close();
}
