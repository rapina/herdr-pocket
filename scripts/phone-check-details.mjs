import assert from 'node:assert/strict';
import { connect } from './phone-cdp.mjs';
const c = await connect();
try {
  const snapshot = await c.evaluate('state.snapshot');
  for (const machine of snapshot.machines) {
    const t = snapshot.terminals.find((t) => t.address.startsWith(machine.name + '/'));
    if (!t) continue;
    const result = await c.evaluate(
      `(async()=>{const d=await api('/v1/terminal?address='+encodeURIComponent(${JSON.stringify(t.address)}));return{address:d.terminal.address,hasConversation:Array.isArray(d.conversation.messages)};})()`,
    );
    assert.equal(result.hasConversation, true);
    console.log('REMOTE READ VERIFIED', result.address);
  }
  const shell = snapshot.terminals.find((t) => !t.status && t.agent === 'powershell.exe');
  if (shell) {
    const data = await c.evaluate(
      `api('/v1/terminal?address='+encodeURIComponent(${JSON.stringify(shell.address)}))`,
    );
    assert.equal(data.canSend, false);
    console.log('SHELL SEND DISABLED');
  }
  await c.evaluate('closeDetail()');
} finally {
  c.close();
}
