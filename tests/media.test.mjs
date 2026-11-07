import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mediaReferences, byteRange, createMediaStore } from '../bridge/media.mjs';
import { createBridge } from '../bridge/server.mjs';

test('finds local media links, encoded spaces, Windows paths and relative links', () => {
  assert.equal(mediaReferences('[preview](/C:/work/demo/a.png)')[0].path, 'C:/work/demo/a.png');
  const refs = mediaReferences(
    '[image](file:///C:/work/demo/a%20b.png)\n[clip](<artifacts/my clip.mp4>)\n`C:\\work\\demo\\voice.wav`\nfile:///tmp/demo/test.webm',
  );
  assert.deepEqual(
    refs.map((r) => [r.path, r.kind]),
    [
      ['C:/work/demo/a b.png', 'image'],
      ['artifacts/my clip.mp4', 'video'],
      ['C:\\work\\demo\\voice.wav', 'audio'],
      ['/tmp/demo/test.webm', 'video'],
    ],
  );
  assert.equal(
    mediaReferences('[image](artifacts/render (1).png)')[0].path,
    'artifacts/render (1).png',
  );
  assert.equal(mediaReferences('file:\\\\C:\\work\\demo\\a.png')[0].path, 'C:/work/demo/a.png');
});
test('ignores web URLs, network shares, code fences, active formats and duplicates', () => {
  for (const text of [
    'https://example.com/image.png',
    '[image](https://example.com/a.png)',
    '[image](file://other-machine/share/a.png)',
    '[image](//other/share/a.png)',
    '```text\nfile:///tmp/a.png\n```',
    '[script](file:///tmp/a.svg)',
    '[bad](file:///tmp/a%00.png)',
  ])
    assert.deepEqual(mediaReferences(text), [], text);
  assert.equal(mediaReferences('[one](/tmp/a.png) [two](/tmp/a.png)').length, 1);
});
test('range requests support seeking and reject malformed or unsatisfiable ranges', () => {
  assert.deepEqual(byteRange('bytes=2-5', 10), { start: 2, end: 5, status: 206 });
  assert.deepEqual(byteRange('bytes=-3', 10), { start: 7, end: 9, status: 206 });
  assert.deepEqual(byteRange('bytes=8-', 10), { start: 8, end: 9, status: 206 });
  for (const range of ['bytes=10-', 'bytes=-0', 'bytes=3-1', 'bytes=0-1,5-6', 'bytes=-', 'junk'])
    assert.throws(() => byteRange(range, 10), { status: 416 });
});
test('media routes authenticate, coalesce reads, support ranges and reject replaced sessions', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'pocket-media-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  let reads = 0,
    running = 0,
    maximum = 0,
    replaced = false;
  const media = createMediaStore({
    folder,
    reader: async (asset, file) => {
      assert.equal(asset.machine, 'remote');
      assert.equal(asset.root, '/workspace/demo');
      reads++;
      maximum = Math.max(maximum, ++running);
      await new Promise((r) => setTimeout(r, 30));
      await writeFile(file, Buffer.from('0123456789'));
      running--;
      return { size: 10, mime: 'video/mp4' };
    },
  });
  const terminal = {
    address: 'remote/t1',
    created_ms: 1,
    cwd: '/workspace/demo',
    state: 'live',
    status: { app: 'codex' },
  };
  const token = 'a'.repeat(64);
  const server = createBridge({
    token,
    media,
    hc: async (command) => (command === 'ls' ? { terminals: [terminal] } : terminal),
    sessions: async () => [
      {
        address: terminal.address,
        sessionId: replaced ? 'new' : 'old',
        conversation: {
          messages: [
            {
              id: 'one',
              text: '[clip](artifacts/clip.mp4) [two](artifacts/two.mp4) [three](artifacts/three.mp4) [four](artifacts/four.mp4)',
            },
          ],
        },
      },
    ],
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, extra = {}) =>
    fetch(base + path, { headers: { Authorization: `Bearer ${token}`, ...extra } });
  const detail = await (await call('/v1/terminal?address=remote/t1')).json();
  const item = detail.conversation.messages[0].media[0];
  assert.deepEqual(Object.keys(item).sort(), ['id', 'kind', 'name', 'path']);
  const path = '/v1/media?id=' + item.id;
  assert.equal((await fetch(base + path)).status, 401);
  assert.equal((await call(path, { Origin: 'https://example.com' })).status, 403);
  const replies = await Promise.all([
    call(path, { Range: 'bytes=2-5' }),
    call(path, { Range: 'bytes=-2' }),
  ]);
  assert.equal(replies[0].status, 206);
  assert.equal(replies[0].headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await replies[0].text(), '2345');
  assert.equal(await replies[1].text(), '89');
  assert.equal(reads, 1);
  const queued = await Promise.all(
    detail.conversation.messages[0].media.slice(1).map(async (asset) => {
      const response = await call('/v1/media?id=' + asset.id);
      assert.equal(response.status, 200);
      return response.text();
    }),
  );
  assert.deepEqual(queued, ['0123456789', '0123456789', '0123456789']);
  assert.equal(maximum, 2);
  assert.equal((await call(path, { Range: 'bytes=11-' })).status, 416);
  assert.equal((await call('/v1/media?id=../../secret')).status, 404);
  replaced = true;
  await new Promise((r) => setTimeout(r, 1550));
  assert.equal((await call(path)).status, 410);
});
