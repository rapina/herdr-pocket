import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBridge } from '../bridge/server.mjs';
import { parseInteraction, choiceKeys } from '../bridge/interaction.mjs';

const terminal = {
  address: 'desktop/t1',
  state: 'live',
  created_ms: 123,
  status_ms: 456,
  status: { state: 'blocked', app: 'claude-code', kind: 'question' },
};
const screen = {
  complete: true,
  how: 'screen',
  text: `Old conversation and debug output
─────────────────────────────────
 ☐ Deployment

│ Which environment should be used?

❯ 1. Preview (Recommended)
     Only preview users can access it.
  2. Production
     Available to all users.
  3. Keep the current environment
     Leave the configuration unchanged.
  4. Type something.
─────────────────────────────────
  5. Chat about this

Enter to select · ↑/↓ to navigate · Esc to cancel`,
};
const sessionId = 'session-one';
const token = 'b'.repeat(64);
const request = () => ({
  id: 'answer-request-123456',
  address: terminal.address,
  createdMs: 123,
  sessionId,
  text: 'Production',
  interaction: { id: parseInteraction(terminal, sessionId, screen).id, choiceId: '2' },
});

test('extracts the active question and descriptions, excluding logs and utility actions', () => {
  const prompt = parseInteraction(terminal, sessionId, screen);
  assert.equal(prompt.choices.length, 3);
  assert.ok(prompt.question.includes('Which environment'));
  assert.ok(!prompt.question.includes('debug output'));
  assert.equal(prompt.choices[1].description, 'Available to all users.');
  assert.deepEqual(choiceKeys(prompt, '2'), ['down', 'enter']);
  assert.deepEqual(choiceKeys({ ...prompt, selected: 3 }, '1'), ['up', 'up', 'enter']);
  assert.equal(choiceKeys(prompt, '4'), null);
  assert.equal(choiceKeys(prompt, 'ctrl+c'), null);
});
test('permission context includes the command; unsupported or partial dialogs are not actionable', () => {
  const permission = {
    ...screen,
    text: `Would you like to run the following command?\n\n  $ deploy --preview\n\n› 1. Yes, proceed (y)\n  2. No, cancel (esc)\n\nPress enter to confirm or esc to cancel`,
  };
  assert.ok(
    parseInteraction(
      { ...terminal, status: { ...terminal.status, app: 'codex', kind: 'permission' } },
      sessionId,
      permission,
    ).question.includes('$ deploy --preview'),
  );
  for (const value of [
    { ...screen, complete: false },
    { ...screen, how: 'history' },
    { ...screen, text: screen.text.replace('❯', ' ') },
    {
      ...screen,
      text: screen.text.replace('Enter to select', 'Space to select · Enter to confirm'),
    },
  ])
    assert.equal(parseInteraction(terminal, sessionId, value), null);
  assert.equal(
    parseInteraction(
      { ...terminal, status: { ...terminal.status, kind: 'auth' } },
      sessionId,
      screen,
    ),
    null,
  );
  assert.equal(parseInteraction(terminal, null, screen), null);
});

async function fixture(t) {
  const calls = [];
  const state = { screen, terminal, sessionId, fail: false };
  const hc = async (...args) => {
    calls.push(args);
    if (args[0] === 'get') return state.terminal;
    if (args[0] === 'read') return state.screen;
    if (args[0] === 'keys') {
      if (state.fail) throw Error('uncertain');
      return { turn: 1 };
    }
    throw Error('Unexpected command');
  };
  const server = createBridge({
    token,
    hc,
    sessions: async () => [
      { sessionId: state.sessionId, conversation: { messages: [], hasMore: false } },
    ],
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const call = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { call, calls, state };
}
test('terminal API exposes choices; explicit selection sends keys once and never force-pastes', async (t) => {
  const f = await fixture(t);
  const detail = await (await f.call('/v1/terminal?address=desktop/t1')).json();
  assert.equal(detail.canSend, false);
  assert.equal(detail.interaction.choices.length, 3);
  const results = await Promise.all([
    f.call('/v1/message', request()),
    f.call('/v1/message', request()),
  ]);
  assert.ok(results.every((r) => r.ok));
  assert.deepEqual(
    f.calls.filter((c) => c[0] === 'keys'),
    [['keys', terminal.address, '--json', 'down', 'enter']],
  );
  assert.equal(
    f.calls.some((c) => c.includes('--force') || c[0] === 'send'),
    false,
  );
  assert.equal(
    (await f.call('/v1/message', { ...request(), id: 'another-request-12345' })).status,
    409,
  );
});
test('changed question, cursor, session, terminal, or forged choice rejects before keys', async (t) => {
  for (const modify of [
    (f) => {
      f.state.screen = {
        ...screen,
        text: screen.text.replace('Which environment', 'Which project'),
      };
    },
    (f) => {
      f.state.screen = {
        ...screen,
        text: screen.text.replace('❯ 1.', '  1.').replace('  2.', '❯ 2.'),
      };
    },
    (f) => {
      f.state.sessionId = 'different';
    },
    (f) => {
      f.state.terminal = { ...terminal, created_ms: 999 };
    },
    (f) => {
      f.state.terminal = { ...terminal, status: { ...terminal.status, state: 'working' } };
    },
  ]) {
    const f = await fixture(t);
    modify(f);
    assert.equal((await f.call('/v1/message', request())).status, 409);
    assert.equal(
      f.calls.some((c) => c[0] === 'keys'),
      false,
    );
  }
  const f = await fixture(t);
  assert.equal(
    (
      await f.call('/v1/message', {
        ...request(),
        interaction: { ...request().interaction, choiceId: 'ctrl+c' },
      })
    ).status,
    400,
  );
  assert.equal(
    f.calls.some((c) => c[0] === 'keys'),
    false,
  );
});
test('unknown key delivery is recorded and is never repeated', async (t) => {
  const f = await fixture(t);
  f.state.fail = true;
  await f.call('/v1/message', request());
  assert.equal((await (await f.call(`/v1/receipt?id=${request().id}`)).json()).state, 'unknown');
  await f.call('/v1/message', request());
  assert.equal(
    (await f.call('/v1/message', { ...request(), id: 'second-unknown-12345' })).status,
    409,
  );
  assert.equal(f.calls.filter((c) => c[0] === 'keys').length, 1);
});
