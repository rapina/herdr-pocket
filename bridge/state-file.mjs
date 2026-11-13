import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Write the temporary file to disk before renaming it. Without the flush, a
// crash or power loss can keep the rename but lose the data, leaving a file of
// NUL bytes in place of the old state.
export function saveJsonFile(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, text, { mode: 0o600, flush: true });
  renameSync(`${path}.tmp`, path);
}

// Read saved state that the bridge can rebuild. A damaged file is kept next to
// the original for inspection and the bridge starts from the fallback instead
// of failing to start.
export function loadJsonState(path, fallback, log = console.warn) {
  if (!path || !existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8').replace(/^﻿/, ''));
  } catch (error) {
    const backup = `${path}.corrupt-${Date.now()}`;
    renameSync(path, backup);
    log(`Ignoring unreadable state file ${path} (${error.message}); moved it to ${backup}`);
    return fallback;
  }
}
