import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBridge } from '../bridge/server.mjs';

const token = 'a'.repeat(64);
const baseTerminal = { state: 'live', created_ms: 123, status: { app: 'codex', state: 'idle' } };
async function fixture(t, terminal = baseTerminal, options = {}) {
  const calls = [];
  const hc = async (...args) => {
    calls.push(args);
    if (args[0] === 'get') return terminal;
    if (args[0] === 'ls') return { terminals: [], machines: [] };
    if (args[0] === 'send') {
      if (options.fail) throw Error('timeout');
      return options.sendResult || { sent: true };
    }
    return { text: '<script>alert(1)</script>' };
  };
  const server = createBridge({ token, hc, ...options });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = (path, body, auth = token) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { call, calls };
}
const message = (id = '12345678-abcd-1234-abcd-123456789000') => ({
  id,
  address: 'desktop/t1',
  createdMs: 123,
  text: '메시지 $(secret) `literal` "quotes"\n두 번째 줄',
});
test('requires authentication; no snapshot is exposed without the token', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call('/v1/snapshot', null, 'wrong')).status, 401);
  assert.equal(f.calls.length, 0);
});
test('passes text as one argv and deduplicates concurrent retries', async (t) => {
  const f = await fixture(t);
  const responses = await Promise.all([
    f.call('/v1/message', message()),
    f.call('/v1/message', message()),
  ]);
  assert.ok(responses.every((r) => r.ok));
  assert.equal(f.calls.filter((a) => a[0] === 'send').length, 1);
  const args = f.calls.find((a) => a[0] === 'send');
  assert.equal(args.at(-1), message().text);
  assert.equal(args.at(-2), '--');
  assert.ok(args.includes('--if'));
});
test('rejects shell, blocked and replaced terminals before sending', async (t) => {
  for (const terminal of [
    { ...baseTerminal, status: { app: 'powershell.exe', state: 'idle' } },
    { ...baseTerminal, status: { app: 'codex', state: 'blocked' } },
    { ...baseTerminal, created_ms: 999 },
  ]) {
    const f = await fixture(t, terminal);
    assert.equal((await f.call('/v1/message', message())).status, 409);
    assert.equal(f.calls.filter((a) => a[0] === 'send').length, 0);
  }
});
test('rejects an option disguised as a terminal and control sequences', async (t) => {
  const f = await fixture(t);
  for (const body of [
    { ...message(), address: '--help' },
    { ...message(), text: '\x1b[31m' },
  ])
    assert.equal((await f.call('/v1/message', body)).status, 400);
  assert.equal(f.calls.length, 0);
});
test('deduplication survives server restart; different payload cannot reuse ID', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'herdr-pocket-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const f = await fixture(t, baseTerminal, { folder });
  await f.call('/v1/message', message());
  const g = await fixture(t, baseTerminal, { folder });
  assert.equal((await g.call('/v1/message', message())).status, 200);
  assert.equal(g.calls.length, 0);
  assert.equal((await g.call('/v1/message', { ...message(), text: 'different' })).status, 409);
});
test('ambiguous send is recorded and never retried automatically', async (t) => {
  const f = await fixture(t, baseTerminal, { fail: true });
  await f.call('/v1/message', message());
  const receipt = await (await f.call(`/v1/receipt?id=${message().id}`)).json();
  assert.equal(receipt.state, 'unknown');
  await f.call('/v1/message', message());
  assert.equal(f.calls.filter((a) => a[0] === 'send').length, 1);
});

test('unconfirmed task start remains uncertain without resending', async (t) => {
  const f = await fixture(t, baseTerminal, { sendResult: { started: false, status: 'idle' } });
  await f.call('/v1/message', message());
  const receipt = await (await f.call(`/v1/receipt?id=${message().id}`)).json();
  assert.equal(receipt.state, 'unknown');
  assert.equal(receipt.message, 'delivery_uncertain');
  await f.call('/v1/message', message());
  assert.equal(f.calls.filter((a) => a[0] === 'send').length, 1);
});

test('old receipts with started false are corrected on startup', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'herdr-pocket-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(
    join(folder, 'receipts.json'),
    JSON.stringify([
      [
        message().id,
        {
          id: message().id,
          address: message().address,
          state: 'sent',
          result: { started: false },
        },
      ],
    ]),
  );
  const f = await fixture(t, baseTerminal, { folder });
  assert.equal((await (await f.call(`/v1/receipt?id=${message().id}`)).json()).state, 'unknown');
});

test('terminal without a matched conversation cannot send from the app', async (t) => {
  const f = await fixture(t);
  assert.equal((await (await f.call('/v1/terminal?address=desktop/t1')).json()).canSend, false);
});
