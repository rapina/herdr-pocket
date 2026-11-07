import assert from 'node:assert/strict';
import { connect } from './phone-cdp.mjs';
const c = await connect();
async function until(expression) {
  const end = Date.now() + 30000;
  while (Date.now() < end) {
    const r = await c.evaluate(expression);
    if (r) return r;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw Error(`Timed out: ${expression}`);
}
try {
  await until('state.online && state.snapshot?.terminals.some(t=>t.sessionId)');
  const addresses = process.argv.slice(2);
  const targets = await c.evaluate(
    `state.snapshot.terminals.filter(t=>t.sessionId&&(${JSON.stringify(addresses)}.length===0||${JSON.stringify(addresses)}.includes(t.address))).slice(0,3).map(t=>[t.address,t.project])`,
  );
  assert.ok(targets.length, 'No matched sessions; pass an address explicitly.');
  for (const [address, project] of targets) {
    const terminal = await c.evaluate(
      `state.snapshot.terminals.find(t=>t.address===${JSON.stringify(address)})`,
    );
    assert.equal(terminal.project, project);
    assert.ok(terminal.sessionId);
    console.log(
      'PROJECT',
      project,
      'STATUS',
      terminal.status?.state,
      'SESSION',
      terminal.sessionId,
    );
    await c.evaluate(`openDetail(${JSON.stringify(address)})`);
    await until(
      `state.detail?.terminal.address===${JSON.stringify(address)} && state.chatMessages.length>0`,
    );
    const data = await c.evaluate(
      `({project:document.querySelector('.detail-heading h2').textContent,roles:state.chatMessages.map(m=>m.role),count:document.querySelectorAll('.chat-message').length,hasRawOutput:!!document.querySelector('pre.output'),overflow:document.documentElement.scrollWidth>innerWidth,session:state.chatSession})`,
    );
    assert.equal(data.project, project);
    assert.ok(data.roles.includes('user'));
    assert.ok(data.roles.includes('assistant'));
    assert.equal(data.hasRawOutput, false);
    assert.equal(data.overflow, false);
    assert.equal(data.session, terminal.sessionId);
    console.log('CHAT VERIFIED', project, data.count, 'messages');
  }
} finally {
  c.close();
}
