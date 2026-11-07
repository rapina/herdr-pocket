import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const context = { IntersectionObserver: class {}, URL };
vm.runInNewContext(readFileSync('app/src/main/assets/message-content.js', 'utf8'), context);
const parts = (text) => JSON.parse(JSON.stringify(context.messageParts(text)));

test('bold spans remain separate, including single-character spans', () => {
  const nodes = JSON.parse(JSON.stringify(context.inlineParts('**One** and **B** **<img>**')));
  assert.deepEqual(
    nodes.filter((n) => n.type === 'bold').map((n) => n.text),
    ['One', 'B', '<img>'],
  );
});

test('links preserve labels, balanced URL parentheses, queries and trailing punctuation', () => {
  const result = JSON.parse(
    JSON.stringify(
      context.inlineParts(
        '[Guide](https://example.com/a_(b)?q=1&x=2#part) https://example.com/end).',
      ),
    ),
  );
  assert.equal(result[0].text, 'Guide');
  assert.equal(result[0].target, 'https://example.com/a_(b)?q=1&x=2#part');
  assert.equal(result[2].target, 'https://example.com/end');
  assert.equal(result[3].text, ').');
  assert.equal(context.inlineParts('`https://example.com`')[0].type, 'code');
  assert.equal(context.inlineParts('**[Guide](https://example.com)**')[0].type, 'bold');
});

test('unsafe schemes, credentials and network shares never become actionable links', () => {
  for (const target of [
    'javascript:alert(1)',
    'data:text/html,bad',
    'intent://app',
    'content://provider',
    'https://user:secret@example.com',
    'https://pocket-media.invalid/id',
    'file://server/share/file.png',
    '//server/share/file.png',
    'https://example.com/\nnext',
  ])
    assert.equal(context.messageLink(target), null, target);
  for (const text of ['[x](javascript:alert(1))', '[x](data:text/html,bad)'])
    assert.equal(
      context.inlineParts(text).some((p) => p.type === 'link'),
      false,
    );
});

test('local Markdown and file URI links resolve to the same attachment path', () => {
  for (const target of [
    'file:///C:/work/demo/image%20one.png',
    '/C:/work/demo/image one.png',
    'C:\\work\\demo\\image one.png',
  ]) {
    assert.equal(context.messageLink(target).target, 'C:/work/demo/image one.png');
    assert.equal(context.messageLink(target).kind, 'local');
  }
  assert.equal(context.messageLink('artifacts/report.pdf').target, 'artifacts/report.pdf');
});

test('complete Mermaid fences preserve surrounding text', () => {
  assert.deepEqual(parts('Before\n```mermaid\ngraph TD\nA-->B\n```\nAfter'), [
    { type: 'text', text: 'Before\n' },
    { type: 'mermaid', text: 'graph TD\nA-->B' },
    { type: 'text', text: 'After' },
  ]);
  assert.deepEqual(parts('~~~MERMAID\r\ngraph TD\r\nA-->B\r\n~~~'), [
    { type: 'mermaid', text: 'graph TD\r\nA-->B' },
  ]);
});

test('incomplete fences and raw HTML stay plain text', () => {
  for (const text of ['```mermaid\ngraph TD\nA-->B', '```text\nhttps://example.com'])
    assert.deepEqual(parts(text), [{ type: 'literal', text }]);
  const text = '<svg onload="alert(1)"></svg>';
  assert.deepEqual(parts(text), [{ type: 'text', text }]);
});

test('text, other languages and unlabelled fences become literal code', () => {
  for (const language of ['text', 'plaintext', 'js', '']) {
    assert.deepEqual(parts('```' + language + '\n  a <b>\n    c\n```'), [
      { type: 'code', text: '  a <b>\n    c' },
    ]);
  }
  assert.deepEqual(parts('````text\n```mermaid\ngraph TD\nA-->B\n```\n````'), [
    { type: 'code', text: '```mermaid\ngraph TD\nA-->B\n```' },
  ]);
});
