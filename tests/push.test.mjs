import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPushHub, createFcmSender, notificationPreview } from '../bridge/push.mjs';
import { createBridge } from '../bridge/server.mjs';

const config = { options: { projectId: 'example-project' } };
const terminal = (state = 'working', extra = {}) => ({
  address: 'workstation/t1',
  sessionId: 'private-session',
  created_ms: 12,
  state: 'live',
  status: { state, app: 'codex' },
  lastResponseAt: '2026-01-01T10:00:00Z',
  ...extra,
});
function setup(options = {}) {
  let time = 1000000;
  const sent = [],
    hub = createPushHub({
      config,
      send: async (token, event) => sent.push({ token, event }),
      now: () => time,
      ...options,
    });
  const id = randomUUID();
  hub.register({ id, token: 'test-device-token-'.repeat(4) });
  return { hub, sent, id, advance: (n) => (time += n) };
}
test('baseline is silent, transitions deduplicate, and payloads contain no conversation identifiers', async () => {
  const { hub, sent } = setup();
  hub.observe([terminal()]);
  await hub.flush();
  assert.equal(sent.length, 0);
  const blocked = terminal('blocked', { pushPrompt: 'prompt-one' });
  hub.observe([blocked]);
  await hub.flush();
  hub.observe([blocked]);
  await hub.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event.kind, 'input');
  hub.observe([terminal('blocked', { pushPrompt: 'prompt-two' })]);
  await hub.flush();
  assert.equal(sent.length, 2);
  hub.observe([terminal('working', { lastResponseAt: '2026-01-01T10:01:00Z' })]);
  await hub.flush();
  assert.equal(sent.length, 2);
  hub.observe([terminal('done', { lastResponseAt: '2026-01-01T10:01:00Z' })]);
  await hub.flush();
  assert.equal(sent.at(-1).event.kind, 'done');
  hub.observe([terminal('done', { lastResponseAt: '2026-01-01T10:01:00Z' })]);
  await hub.flush();
  assert.equal(sent.length, 3);
  assert.doesNotMatch(
    JSON.stringify(sent.map((s) => s.event)),
    /private-session|workstation|lastResponseAt|prompt/,
  );
});
test('completion events retain the matching response preview across retries', async () => {
  let fail = true;
  const delivered = [];
  const { hub, advance } = setup({
    send: async (_, event) => {
      if (fail) throw Error('offline');
      delivered.push(event);
    },
  });
  hub.observe([terminal()]);
  hub.observe([
    terminal('done', { lastResponseAt: 'new', lastResponseText: '  빌드 완료\n설치했습니다.  ' }),
  ]);
  await hub.flush();
  hub.observe([terminal('done', { lastResponseAt: 'new', lastResponseText: 'different text' })]);
  fail = false;
  advance(11000);
  await hub.flush();
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].preview, '빌드 완료\n설치했습니다.');
});

test('preview fits the FCM budget including Unicode and JSON escaping', () => {
  for (const text of ['한글😀'.repeat(2000), '"\\\n'.repeat(2000)]) {
    const preview = notificationPreview(text);
    assert.ok(Buffer.byteLength(JSON.stringify(preview)) - 2 <= 2000);
    assert.ok(preview.endsWith('…'));
    assert.ok(text.startsWith(preview.slice(0, -1)));
    assert.equal(Buffer.from(preview).toString(), preview);
  }
  assert.equal(notificationPreview('  답변\n완료  '), '답변\n완료');
  assert.equal(notificationPreview(null), '');
  assert.equal(notificationPreview(' \n '), '');
});

test('unknown and disconnected states are not errors; replaced sessions cannot resolve old notifications', async () => {
  const { hub, sent } = setup();
  const key = hub.decorate(terminal()).notificationKey;
  hub.observe([terminal()]);
  hub.observe([terminal('unknown'), terminal('error', { unavailable: true })]);
  await hub.flush();
  assert.equal(sent.length, 0);
  hub.observe([terminal('error')]);
  await hub.flush();
  assert.equal(sent[0].event.kind, 'error');
  assert.equal(hub.resolveKey(key, [terminal()]).address, 'workstation/t1');
  assert.throws(() => hub.resolveKey(key, [terminal('working', { sessionId: 'replacement' })]), {
    status: 410,
  });
  assert.throws(() => hub.resolveKey(key, [terminal('working', { created_ms: 13 })]), {
    status: 410,
  });
});
test('restart retains deduplication and registration; long gaps establish a fresh baseline', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'pocket-push-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const first = setup({ folder });
  first.hub.observe([terminal()]);
  first.hub.observe([terminal('blocked')]);
  await first.hub.flush();
  const next = [],
    hub = createPushHub({
      folder,
      config,
      now: () => 1000001,
      send: async (_, event) => next.push(event),
    });
  hub.observe([terminal('blocked')]);
  await hub.flush();
  assert.equal(next.length, 0);
  const late = createPushHub({
    folder,
    config,
    now: () => 5000000,
    send: async (_, event) => next.push(event),
  });
  late.observe([terminal('done', { lastResponseAt: '2026-01-02T10:00:00Z' })]);
  await late.flush();
  assert.equal(next.length, 0);
});
test('failed pushes back off, superseded events expire, and unregister removes pending sends', async () => {
  let calls = 0;
  const { hub, id, advance } = setup({
    send: async () => {
      calls++;
      throw Error('offline');
    },
  });
  hub.observe([terminal()]);
  hub.observe([terminal('blocked')]);
  await hub.flush();
  await hub.flush();
  assert.equal(calls, 1);
  advance(11000);
  await hub.flush();
  assert.equal(calls, 2);
  hub.observe([terminal('working')]);
  advance(30000);
  await hub.flush();
  assert.equal(calls, 2);
  hub.observe([terminal('blocked')]);
  hub.remove(id);
  await hub.flush();
  assert.equal(calls, 2);
});
test('unregistered FCM tokens are retired', async () => {
  let calls = 0;
  const { hub } = setup({
    send: async () => {
      calls++;
      throw Object.assign(Error('gone'), { invalidToken: true });
    },
  });
  hub.observe([terminal()]);
  hub.observe([terminal('blocked')]);
  await hub.flush();
  hub.observe([terminal('working')]);
  hub.observe([terminal('error')]);
  await hub.flush();
  assert.equal(calls, 1);
});
test('FCM transport uses scoped OAuth and data-only messages with bounded lifetime', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const calls = [];
  const sender = createFcmSender(
    {
      options: config.options,
      account: { client_email: 'sender@example.invalid', private_key: privateKey },
    },
    async (url, request) => {
      calls.push({ url, request });
      return { ok: true, json: async () => ({ access_token: 'fake-access', expires_in: 3600 }) };
    },
  );
  const event = { id: randomUUID(), key: randomUUID(), kind: 'input', at: 100 };
  await sender('fake-device', event);
  await sender('fake-device', { ...event, kind: 'done', preview: '답변😀'.repeat(2000) });
  assert.equal(calls.length, 3);
  const claims = JSON.parse(
    Buffer.from(calls[0].request.body.get('assertion').split('.')[1], 'base64url'),
  );
  assert.equal(claims.scope, 'https://www.googleapis.com/auth/firebase.messaging');
  const input = JSON.parse(calls[1].request.body).message;
  assert.equal(input.notification, undefined);
  assert.equal(input.android.ttl, '900s');
  assert.equal(input.android.priority, 'HIGH');
  assert.deepEqual(Object.keys(input.data).sort(), ['createdAt', 'eventId', 'kind', 'sessionKey']);
  assert.equal(JSON.parse(calls[2].request.body).message.android.priority, 'HIGH');
  const done = JSON.parse(calls[2].request.body).message;
  assert.ok(done.data.preview.startsWith('답변😀'));
  assert.ok(Buffer.byteLength(JSON.stringify(done.data)) < 4096);
  assert.equal(input.android.collapse_key, undefined);
});
test('push endpoints require bridge authentication and reject invalid registration', async (t) => {
  const { hub } = setup();
  const token = 'a'.repeat(64);
  const server = createBridge({ token, push: hub, hc: async () => ({ terminals: [] }) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base + '/v1/push/options')).status, 401);
  const response = await fetch(base + '/v1/push/device', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'bad', token: 'bad' }),
  });
  assert.equal(response.status, 400);
  assert.throws(() => createPushHub({}).register({}), { status: 503 });
});
test('a state file damaged by a crash is set aside instead of stopping the bridge', (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'pocket-push-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'push-state.json'), Buffer.alloc(64));
  writeFileSync(join(folder, 'receipts.json'), Buffer.alloc(64));
  const warn = console.warn;
  console.warn = () => {};
  t.after(() => (console.warn = warn));
  const hub = createPushHub({ folder, config, send: async () => {} });
  hub.register({ id: randomUUID(), token: 'test-device-token-'.repeat(4) });
  createBridge({ token: 'x'.repeat(32), folder, push: hub });
  const names = readdirSync(folder);
  assert.equal(names.filter((n) => n.startsWith('push-state.json.corrupt-')).length, 1);
  assert.equal(names.filter((n) => n.startsWith('receipts.json.corrupt-')).length, 1);
  assert.ok(JSON.parse(readFileSync(join(folder, 'push-state.json'), 'utf8')).devices);
});
