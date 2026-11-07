import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../app/src/main/assets/i18n.js', import.meta.url), 'utf8');
function load(storage = new Map(), language = 'en-US') {
  return runInNewContext(`${source}; I18n`, {
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    navigator: { language },
    document: { documentElement: {} },
  });
}
test('translations have both languages and matching interpolation fields', () => {
  for (const [key, message] of Object.entries(load().messages)) {
    assert.ok(message.ko && message.en, key);
    const fields = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(fields(message.ko), fields(message.en), key);
  }
});
test('language preference survives reload and legacy receipt text translates', () => {
  const storage = new Map();
  const first = load(storage, 'ko-KR');
  assert.equal(first.language, 'ko');
  first.setLanguage('en');
  const second = load(storage, 'ko-KR');
  assert.equal(second.language, 'en');
  assert.equal(second.text('보내는 중…'), second.text('sending'));
  assert.equal(second.text('activity_running', { activity: 'Editing' }), 'Editing in progress');
});
