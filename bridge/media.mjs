import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync, createReadStream } from 'node:fs';
import { mkdir, open, unlink, readdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = readFileSync(new URL('./media_reader.py', import.meta.url), 'utf8');
const bootstrap = `import base64;exec(compile(base64.b64decode('${Buffer.from(source).toString('base64')}'),'pocket-media-reader','exec'))`;
const limit = 128 * 1024 * 1024;
const failure = (status, message) => Object.assign(Error(message), { status });
const extensions =
  /\.(png|jpe?g|gif|webp|bmp|avif|mp4|m4v|mov|webm|ogv|mp3|wav|ogg|opus|m4a|aac|flac|weba)$/i;
export function mediaReferences(text) {
  // Code fences are examples, not attachments. Inline code paths are supported.
  const plain = String(text || '').replace(
    /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,
    '',
  );
  const found = new Map();
  const add = (raw) => {
    let path = raw.trim().replace(/^<|>$/g, '');
    try {
      if (/^file:/i.test(path)) {
        path = path.replace(/\\/g, '/');
        const uri = new URL(path);
        if (uri.hostname && uri.hostname !== 'localhost') return;
        path = decodeURIComponent(uri.pathname).replace(/^\/([a-z]:\/)/i, '$1');
      } else {
        if (/^[a-z][\w+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return;
        path = decodeURIComponent(path);
      }
      path = path.replace(/^\/([a-z]:[\\/])/i, '$1');
    } catch {
      return;
    }
    if (
      !extensions.test(path) ||
      path.length > 4096 ||
      /[\x00-\x1f]/.test(path) ||
      /^[\\/]{2}/.test(path)
    )
      return;
    const ext = path.match(extensions)[1].toLowerCase();
    const kind = /^(png|jpe?g|gif|webp|bmp|avif)$/.test(ext)
      ? 'image'
      : /^(mp4|m4v|mov|webm|ogv)$/.test(ext)
        ? 'video'
        : 'audio';
    found.set(path, { path, name: path.replaceAll('\\', '/').split('/').at(-1), kind });
  };
  for (const m of plain.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))+)\s*\)/g))
    add(m[1]);
  for (const m of plain.matchAll(/`([^`\n]+)`/g)) add(m[1]);
  for (const m of plain.matchAll(
    /(?:^|[\s<(])((?:file:[\/\\]+|[a-z]:[\/\\]|\/(?!\/))[^\s<>"'`\]\)]+)/gi,
  ))
    add(m[1].replace(/[.,;]+$/, ''));
  return [...found.values()].slice(0, 12);
}

export function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, status: 200 };
  const m = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!m || (!m[1] && !m[2])) throw failure(416, 'media_range');
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size)
    throw failure(416, 'media_range');
  return { start, end, status: 206 };
}

export async function readMedia(asset, destination, binary = process.env.HC_PATH || 'hc') {
  for (const python of ['python', 'python3']) {
    const env = { ...process.env };
    delete env.HC_TERMINAL_ID;
    const child = spawn(
      binary,
      [
        'exec',
        ...(asset.machine ? ['--on', asset.machine] : []),
        '--timeout',
        '90',
        '-i',
        '--',
        python,
        '-c',
        bootstrap,
      ],
      { env, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] },
    );
    const exited = new Promise((r) => {
      child.on('error', () => r(-1));
      child.on('close', r);
    });
    const timeout = setTimeout(() => child.kill(), 95000);
    child.stdin.on('error', () => {});
    child.stdin.end(
      JSON.stringify({
        root: asset.root,
        path: asset.path,
        agent: asset.agent,
        sessionId: asset.sessionId,
      }),
    );
    let file,
      metadata,
      header = Buffer.alloc(0),
      written = 0;
    try {
      file = await open(destination, 'w', 0o600);
      for await (let chunk of child.stdout) {
        if (!metadata) {
          header = Buffer.concat([header, chunk]);
          const newline = header.indexOf(10);
          if (newline < 0) {
            if (header.length > 4096) throw failure(502, 'media_failed');
            continue;
          }
          metadata = JSON.parse(header.subarray(0, newline).toString('utf8'));
          if (metadata.error)
            throw failure(metadata.error === 'media_forbidden' ? 403 : 422, metadata.error);
          if (
            !Number.isSafeInteger(metadata.size) ||
            metadata.size < 1 ||
            metadata.size > limit ||
            !/^(image|video|audio)\/[a-z0-9.+-]+$/.test(metadata.mime)
          )
            throw failure(502, 'media_failed');
          chunk = header.subarray(newline + 1);
          header = Buffer.alloc(0);
        }
        written += chunk.length;
        if (written > metadata.size) throw failure(502, 'media_failed');
        await file.writeFile(chunk);
      }
      const code = await exited;
      if (code !== 0 || !metadata || written !== metadata.size) throw failure(502, 'media_failed');
      return metadata;
    } catch (error) {
      child.kill();
      await exited;
      if (error.status && error.status !== 502) throw error;
      if (python === 'python3') throw failure(502, 'media_failed');
    } finally {
      clearTimeout(timeout);
      await file?.close();
    }
  }
}

export function createMediaStore({ folder, reader = readMedia, now = Date.now } = {}) {
  const assets = new Map(),
    flights = new Map(),
    cache = new Map();
  const directory = resolve(folder || '.local', 'media-cache');
  const salt = randomBytes(32).toString('hex');
  const lifetime = 30 * 60 * 1000;
  let active = 0;
  const waiting = [];
  const acquire = () => {
    if (active < 2) {
      active++;
      return Promise.resolve();
    }
    if (waiting.length >= 24) return Promise.reject(failure(429, 'media_busy'));
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    if (waiting.length) waiting.shift()();
    else active--;
  };
  const clean = async () => {
    for (const [id, item] of cache)
      if (now() - item.at > 60000) {
        cache.delete(id);
        await unlink(item.file).catch(() => {});
      }
    for (const [id, asset] of assets) if (now() - asset.at > lifetime) assets.delete(id);
    // Remove expired files left by an interrupted bridge process as well.
    for (const name of await readdir(directory).catch(() => [])) {
      if (!/^[a-f0-9]{64}\.bin$/.test(name) || flights.has(name.slice(0, -4))) continue;
      const file = resolve(directory, name);
      const info = await stat(file).catch(() => null);
      if (info && now() - info.mtimeMs > 120000 && !cache.has(name.slice(0, -4)))
        await unlink(file).catch(() => {});
    }
  };
  const cleanupTimer = setInterval(() => clean().catch(() => {}), 60000);
  cleanupTimer.unref();
  return {
    close() {
      clearInterval(cleanupTimer);
      for (const item of cache.values()) unlink(item.file).catch(() => {});
      cache.clear();
    },
    decorate(conversation, terminal) {
      if (!terminal.sessionId || !terminal.cwd) return conversation;
      return {
        ...conversation,
        messages: (conversation.messages || []).map((message) => ({
          ...message,
          media: mediaReferences(message.text).map((ref) => {
            const id = createHash('sha256')
              .update(
                JSON.stringify([
                  salt,
                  terminal.address,
                  terminal.created_ms,
                  terminal.sessionId,
                  terminal.cwd,
                  ref.path,
                ]),
              )
              .digest('hex');
            assets.set(id, {
              ...ref,
              root: terminal.cwd,
              machine: terminal.address.includes('/') ? terminal.address.split('/')[0] : '',
              address: terminal.address,
              createdMs: terminal.created_ms,
              sessionId: terminal.sessionId,
              agent: terminal.agent || terminal.status?.app,
              at: now(),
            });
            while (assets.size > 4000) assets.delete(assets.keys().next().value);
            return { id, name: ref.name, kind: ref.kind, path: ref.path };
          }),
        })),
      };
    },
    async serve(id, req, res, verify) {
      await clean();
      const asset = assets.get(id);
      if (!/^[a-f0-9]{64}$/.test(id || '') || !asset) throw failure(404, 'media_expired');
      if (!(await verify(asset))) throw failure(410, 'media_expired');
      if (!cache.has(id) && !flights.has(id)) {
        const flight = (async () => {
          await acquire();
          const file = resolve(directory, `${id}.bin`);
          try {
            await mkdir(directory, { recursive: true });
            const metadata = await reader(asset, file);
            const item = { ...metadata, file, at: now() };
            cache.set(id, item);
            while (
              cache.size > 8 ||
              [...cache.values()].reduce((sum, value) => sum + value.size, 0) > 256 * 1024 * 1024
            ) {
              const [oldId, old] = cache.entries().next().value;
              cache.delete(oldId);
              await unlink(old.file).catch(() => {});
            }
            return item;
          } catch (error) {
            await unlink(file).catch(() => {});
            throw error;
          } finally {
            release();
          }
        })().finally(() => {
          flights.delete(id);
        });
        flights.set(id, flight);
      }
      const item = cache.get(id) || (await flights.get(id));
      if (res.destroyed) return;
      let range;
      try {
        range = byteRange(req.headers.range, item.size);
      } catch (error) {
        res.setHeader('Content-Range', `bytes */${item.size}`);
        throw error;
      }
      res.writeHead(range.status, {
        'Content-Type': item.mime,
        'Content-Length': range.end - range.start + 1,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(range.status === 206
          ? { 'Content-Range': `bytes ${range.start}-${range.end}/${item.size}` }
          : {}),
      });
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(item.file, { start: range.start, end: range.end });
      stream.on('error', () => res.destroy());
      res.on('close', () => stream.destroy());
      stream.pipe(res);
    },
  };
}
