import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../bridge/server.mjs';
import { displayTerminal } from '../bridge/sessions.mjs';

test('verified Cursor binding supplies status and work timer', () => {
  const t = displayTerminal(
    { agent: 'powershell', status: null },
    {
      agent: 'cursor',
      cursorState: 'working',
      turnStartedAt: '2026-01-01T00:00:00Z',
      sessionId: 'chat',
    },
  );
  assert.equal(t.agent, 'cursor');
  assert.equal(t.status.state, 'working');
  assert.equal(t.workingSince, '2026-01-01T00:00:00Z');
});

test('Cursor sends require the bound idle session and acknowledge a new prompt generation', async (t) => {
  const token = 'a'.repeat(64),
    terminal = { address: 't1', agent: 'powershell', state: 'live', created_ms: 123, status: null };
  let match = { agent: 'cursor', sessionId: 'chat', cursorState: 'done', cursorGeneration: 'old' },
    sendCount = 0;
  const hc = async (...args) => {
    if (args[0] === 'ls') return { terminals: [] };
    if (args[0] === 'get') return terminal;
    if (args[0] === 'send') {
      sendCount++;
      match = { ...match, cursorGeneration: 'new', cursorPrompt: args.at(-1) };
      return { started: null };
    }
    throw Error('Unexpected terminal read');
  };
  const server = createBridge({ token, hc, sessions: async () => [match] });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const body = {
    id: 'cursor-request-0001',
    address: 't1',
    createdMs: 123,
    sessionId: 'chat',
    text: 'hello',
  };
  assert.equal((await (await call('/v1/terminal?address=t1')).json()).canSend, true);
  assert.equal((await call('/v1/message', { ...body, sessionId: 'old' })).status, 409);
  assert.equal((await call('/v1/message', { ...body, sessionId: undefined })).status, 409);
  match.cursorState = 'working';
  assert.equal((await (await call('/v1/terminal?address=t1')).json()).canSend, false);
  assert.equal((await call('/v1/message', body)).status, 409);
  assert.equal(sendCount, 0);
  match.cursorState = 'done';
  assert.equal((await call('/v1/message', body)).status, 202);
  assert.equal((await (await call('/v1/receipt?id=' + body.id)).json()).state, 'sent');
  assert.equal((await call('/v1/message', body)).status, 200);
  assert.equal(sendCount, 1);
});

test('unacknowledged Cursor sends stay uncertain without an automatic retry', async (t) => {
  const token = 'a'.repeat(64);
  let sends = 0;
  const terminal = { address: 't1', state: 'live', created_ms: 123, agent: 'powershell' };
  const match = {
    agent: 'cursor',
    sessionId: 'chat',
    cursorState: 'done',
    cursorGeneration: 'same',
    cursorPrompt: 'hello',
  };
  const server = createBridge({
    token,
    hc: async (cmd) =>
      cmd === 'send' ? (sends++, { started: true }) : cmd === 'ls' ? { terminals: [] } : terminal,
    sessions: async () => [match],
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`,
    headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const body = {
    id: 'cursor-request-0002',
    address: 't1',
    createdMs: 123,
    sessionId: 'chat',
    text: 'hello',
  };
  await fetch(url + '/v1/message', { method: 'POST', headers, body: JSON.stringify(body) });
  let receipt;
  for (let i = 0; i < 30; i++) {
    receipt = await (await fetch(url + '/v1/receipt?id=' + body.id, { headers })).json();
    if (receipt.state !== 'sending') break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(receipt.state, 'unknown');
  assert.equal(sends, 1);
});
