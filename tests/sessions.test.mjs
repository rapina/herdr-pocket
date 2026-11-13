import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displayTerminal } from '../bridge/sessions.mjs';
import { createBridge } from '../bridge/server.mjs';

test('same launch directory produces distinct current project cards with live status', () => {
  const base = { cwd: 'D:\\work\\orbit-api', status: { app: 'codex', state: 'working' } };
  const atlas = displayTerminal({ ...base, title: '⠧ Windows에서 재현 확인 | atlas-core' });
  const orbit = displayTerminal({ ...base, title: '⠏ 패키지 업로드 | orbit-api' });
  assert.equal(atlas.project, 'atlas-core');
  assert.equal(orbit.project, 'orbit-api');
  assert.equal(atlas.status.state, 'working');
  assert.equal(orbit.status.state, 'working');
});

test('response timestamp and active turn start survive terminal projection', () => {
  const metadata = {
    lastResponseAt: '2026-01-01T10:00:00Z',
    lastResponseText: '변경한 내용을 확인했습니다.',
    turnStartedAt: '2026-01-01T11:00:00Z',
  };
  const working = displayTerminal({ status: { state: 'working' }, status_ms: 100 }, metadata);
  assert.equal(working.lastResponseAt, metadata.lastResponseAt);
  assert.equal(working.lastResponseText, metadata.lastResponseText);
  assert.equal(working.workingSince, metadata.turnStartedAt);
  assert.equal(displayTerminal({ status: { state: 'done' } }, metadata).workingSince, null);
});
test('a Claude turn waiting on a background command shows as background work', () => {
  const session = { claudeStatus: 'shell', claudeStatusAt: Date.parse('2026-01-01T12:00:00Z') };
  const waiting = displayTerminal({ status: { app: 'claude-code', state: 'done' } }, session);
  assert.equal(waiting.background, true);
  assert.equal(waiting.workingSince, '2026-01-01T12:00:00.000Z');
  assert.equal(waiting.status.state, 'done');
  const busy = displayTerminal({ status: { state: 'working' }, status_ms: 5 }, session);
  assert.equal(busy.background, false);
  const idle = { claudeStatus: 'idle' };
  assert.equal(displayTerminal({ status: { state: 'done' } }, idle).background, false);
});
test('terminal API returns structured conversation without reading the terminal screen', async (t) => {
  const calls = [],
    token = 'a'.repeat(64);
  const hc = async (...args) => {
    calls.push(args);
    return {
      address: 't1',
      created_ms: 123,
      state: 'live',
      status: { app: 'codex', state: 'working' },
      cwd: 'D:\\work\\orbit-api',
      title: '⠧ Fix | atlas-core',
    };
  };
  const sessions = async () => [
    {
      address: 't1',
      project: 'atlas-core',
      workingCwd: 'D:\\work\\atlas-core',
      sessionId: 'atlas-id',
      conversation: {
        messages: [
          { role: 'user', text: '질문' },
          { role: 'assistant', text: '답변' },
        ],
        hasMore: false,
      },
    },
  ];
  const server = createBridge({ token, hc, sessions });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/terminal?address=t1`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  assert.equal(data.terminal.project, 'atlas-core');
  assert.equal(data.conversation.messages.length, 2);
  assert.equal(data.output, undefined);
  assert.equal(
    calls.some((c) => c[0] === 'read'),
    false,
  );
  const rejected = await fetch(`http://127.0.0.1:${server.address().port}/v1/message`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: '1234567890123456',
      address: 't1',
      text: 'test',
      createdMs: 123,
      sessionId: 'old-session',
    }),
  });
  assert.equal(rejected.status, 409);
  assert.equal(
    calls.some((c) => c[0] === 'send'),
    false,
  );
});
