import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname } from 'node:os';
import { createSessionProvider, displayTerminal } from './sessions.mjs';
import { readInteraction, choiceKeys } from './interaction.mjs';
import { createPushHub, loadPushConfig } from './push.mjs';
import { createMediaStore } from './media.mjs';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export function createHc(binary = process.env.HC_PATH || 'hc') {
  return async (...args) => {
    const env = { ...process.env };
    delete env.HC_TERMINAL_ID;
    try {
      const { stdout } = await exec(binary, args, {
        env,
        windowsHide: true,
        timeout: 18000,
        maxBuffer: 2 * 1024 * 1024,
        encoding: 'utf8',
      });
      return JSON.parse(stdout.replace(/^\uFEFF/, ''));
    } catch (e) {
      if (e.killed || e.code === 'ETIMEDOUT') throw new ApiError(504, 'hc_timeout');
      throw new ApiError(502, 'hc_failed');
    }
  };
}
const agentNames = new Set([
  'codex',
  'claude',
  'claude-code',
  'pi',
  'gemini',
  'gemini-cli',
  'opencode',
  'aider',
  'cursor',
  'cursor-agent',
]);
export function isAgent(t) {
  return agentNames.has(t.status?.app || t.agent);
}
function validateAddress(address) {
  if (typeof address !== 'string' || !/^(?:[a-zA-Z0-9._-]+\/)?t[a-z0-9]+$/.test(address))
    throw new ApiError(400, 'invalid_address');
  return address;
}
const hash = (v) => createHash('sha256').update(v).digest('hex');
function saveJson(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
export function loadConfig(folder = resolve(root, '.local')) {
  mkdirSync(folder, { recursive: true });
  const path = resolve(folder, 'config.json');
  if (!existsSync(path)) saveJson(path, { token: randomBytes(32).toString('hex'), port: 47831 });
  return { ...JSON.parse(readFileSync(path, 'utf8')), folder };
}
export function createBridge({
  token,
  hc = createHc(),
  folder,
  machineName = hostname(),
  sessions = async () => [],
  push = createPushHub({ folder }),
  media = createMediaStore({ folder }),
}) {
  if (!token || token.length < 32) throw new Error('A token of at least 32 characters is required');
  const receiptPath = folder && resolve(folder, 'receipts.json');
  const receipts = new Map(
    receiptPath && existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : [],
  );
  for (const r of receipts.values())
    if (
      r.state === 'sending' ||
      (r.state === 'sent' &&
        !r.interactionId &&
        !r.cursorAcknowledged &&
        r.result?.started === false)
    ) {
      r.state = 'unknown';
      r.message = r.result?.started === false ? 'delivery_uncertain' : 'restart_unknown';
    }
  const persist = () => {
    if (receiptPath) saveJson(receiptPath, [...receipts]);
  };
  persist();
  let snapshotFlight;
  let lastSnapshot;
  const snapshot = async () => {
    if (lastSnapshot && Date.now() - lastSnapshot.at < 1500) return lastSnapshot.data;
    if (!snapshotFlight)
      snapshotFlight = hc('ls', '--json')
        .then(async (data) => {
          const terminals = await Promise.all(
            (data.terminals || []).map(async (t) => {
              try {
                return { ...t, ...(await hc('get', t.address, '--json')) };
              } catch {
                return { ...t, status: null, unavailable: true };
              }
            }),
          );
          const matches = await sessions(terminals);
          const byAddress = new Map(matches.map((s) => [s.address, s]));
          const result = {
            ...data,
            terminals: terminals.map((t) =>
              push.decorate(displayTerminal(t, byAddress.get(t.address))),
            ),
            localMachine: machineName,
            observedAt: new Date().toISOString(),
          };
          lastSnapshot = { at: Date.now(), data: result };
          return result;
        })
        .finally(() => {
          snapshotFlight = null;
        });
    return snapshotFlight;
  };
  const reply = (res, status, data) => {
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(data));
  };
  async function body(req) {
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || ''))
      throw new ApiError(415, 'json_required');
    let bytes = 0;
    const chunks = [];
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > 20000) throw new ApiError(413, 'too_long');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new ApiError(400, 'invalid_json');
    }
  }
  const publicReceipt = (r) => ({
    id: r.id,
    address: r.address,
    state: r.state,
    message: r.message,
    updatedAt: r.updatedAt,
  });
  const server = http.createServer(async (req, res) => {
    try {
      const candidate = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
        throw new ApiError(401, 'unauthorized');
      if (req.headers.origin) throw new ApiError(403, 'browser_forbidden');
      const url = new URL(req.url, 'http://localhost');
      if (['GET', 'HEAD'].includes(req.method) && url.pathname === '/v1/media')
        return await media.serve(url.searchParams.get('id'), req, res, async (asset) => {
          const current = (await snapshot()).terminals.find((t) => t.address === asset.address);
          return (
            current &&
            !current.unavailable &&
            current.sessionId === asset.sessionId &&
            current.created_ms === asset.createdMs &&
            current.cwd === asset.root
          );
        });
      if (req.method === 'GET' && url.pathname === '/v1/push/options')
        return reply(res, 200, push.options());
      if (req.method === 'POST' && url.pathname === '/v1/push/device')
        return reply(res, 200, push.register(await body(req)));
      if (req.method === 'POST' && url.pathname === '/v1/push/remove')
        return reply(res, 200, push.remove((await body(req)).id));
      if (req.method === 'GET' && url.pathname === '/v1/push/resolve')
        return reply(
          res,
          200,
          push.resolveKey(url.searchParams.get('key'), (await snapshot()).terminals),
        );
      if (req.method === 'GET' && url.pathname === '/v1/snapshot')
        return reply(res, 200, await snapshot());
      if (req.method === 'GET' && url.pathname === '/v1/terminal') {
        const address = validateAddress(url.searchParams.get('address'));
        const before = url.searchParams.has('before')
          ? Number(url.searchParams.get('before'))
          : undefined;
        if (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
          throw new ApiError(400, 'invalid_cursor');
        const terminal = await hc('get', address, '--json');
        const match = (await sessions([terminal], address, before))[0];
        const conversation = match?.conversation || {
          messages: [],
          hasMore: false,
          unavailable: 'session_unavailable',
        };
        let interaction = null;
        try {
          interaction = await readInteraction(hc, terminal, match?.sessionId);
        } catch {}
        const displayed = push.decorate(displayTerminal(terminal, match));
        return reply(res, 200, {
          terminal: displayed,
          conversation: media.decorate(conversation, displayed),
          interaction,
          canSend:
            !!match?.sessionId &&
            terminal.state === 'live' &&
            isAgent(displayed) &&
            (match?.agent === 'cursor'
              ? ['idle', 'done'].includes(match.cursorState)
              : terminal.status?.state !== 'blocked'),
          observedAt: new Date().toISOString(),
        });
      }
      if (req.method === 'GET' && url.pathname === '/v1/receipt') {
        const receipt = receipts.get(url.searchParams.get('id'));
        if (!receipt) throw new ApiError(404, 'receipt_missing');
        return reply(res, 200, publicReceipt(receipt));
      }
      if (req.method === 'POST' && url.pathname === '/v1/message') {
        const data = await body(req);
        if (!data || typeof data !== 'object') throw new ApiError(400, 'invalid_request');
        const { id, text, createdMs } = data;
        const address = validateAddress(data.address);
        if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(id))
          throw new ApiError(400, 'invalid_id');
        if (
          typeof text !== 'string' ||
          !text.trim() ||
          text.length > 4000 ||
          /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text)
        )
          throw new ApiError(400, 'invalid_text');
        if (!Number.isSafeInteger(createdMs)) throw new ApiError(400, 'reopen');
        const fingerprint = hash(
          JSON.stringify([
            address,
            text,
            createdMs,
            data.sessionId || null,
            ...(data.interaction ? [data.interaction] : []),
          ]),
        );
        const previous = receipts.get(id);
        if (previous) {
          if (previous.fingerprint !== fingerprint) throw new ApiError(409, 'id_reused');
          return reply(res, 200, publicReceipt(previous));
        }
        if ([...receipts.values()].some((r) => r.address === address && r.state === 'sending'))
          throw new ApiError(409, 'send_in_progress');
        const terminal = await hc('get', address, '--json');
        if (terminal.created_ms !== createdMs || terminal.state !== 'live')
          throw new ApiError(409, 'target_changed');
        let match;
        const rawCursor = ['cursor', 'cursor-agent'].includes(
          terminal.status?.app || terminal.agent,
        );
        if (data.sessionId || !isAgent(terminal) || rawCursor) {
          match = (await sessions([terminal]))[0];
          if (match?.sessionId !== data.sessionId) throw new ApiError(409, 'session_changed');
        }
        const cursor = match?.agent === 'cursor';
        if (rawCursor && !cursor) throw new ApiError(409, 'session_changed');
        if (!isAgent(terminal) && !cursor) throw new ApiError(409, 'target_changed');
        if (
          cursor &&
          (!data.sessionId || !['idle', 'done'].includes(match.cursorState) || data.interaction)
        )
          throw new ApiError(409, 'approval_required');
        let keys;
        if (data.interaction) {
          if (
            !data.sessionId ||
            typeof data.interaction.id !== 'string' ||
            typeof data.interaction.choiceId !== 'string'
          )
            throw new ApiError(400, 'invalid_choice');
          const current = await readInteraction(hc, terminal, data.sessionId);
          if (!current || current.id !== data.interaction.id)
            throw new ApiError(409, 'question_changed');
          keys = choiceKeys(current, data.interaction.choiceId);
          if (!keys) throw new ApiError(400, 'invalid_choice');
          // A distinct request ID must not submit the same dialog twice.
          if (
            [...receipts.values()].some(
              (r) => r.address === address && r.interactionId === current.id,
            )
          )
            throw new ApiError(409, 'question_answered');
          const latest = await hc('get', address, '--json');
          if (
            latest.created_ms !== createdMs ||
            latest.status?.state !== 'blocked' ||
            latest.status_ms !== terminal.status_ms
          )
            throw new ApiError(409, 'question_changed');
        } else if (terminal.status?.state === 'blocked')
          throw new ApiError(409, 'approval_required');
        // Recheck after the asynchronous lookup so concurrent retries share one receipt.
        if (receipts.has(id)) {
          const r = receipts.get(id);
          if (r.fingerprint !== fingerprint) throw new ApiError(409, 'id_conflict');
          return reply(res, 200, publicReceipt(r));
        }
        if ([...receipts.values()].some((r) => r.address === address && r.state === 'sending'))
          throw new ApiError(409, 'sending_conflict');
        if (
          data.interaction &&
          [...receipts.values()].some(
            (r) => r.address === address && r.interactionId === data.interaction.id,
          )
        )
          throw new ApiError(409, 'question_answered');
        const r = {
          id,
          address,
          fingerprint,
          state: 'sending',
          message: 'delivery_sending',
          updatedAt: new Date().toISOString(),
          ...(data.interaction ? { interactionId: data.interaction.id } : {}),
        };
        receipts.set(id, r);
        // Persist before invoking hc; an ambiguous result must never trigger an automatic resend.
        persist();
        reply(res, 202, publicReceipt(r));
        try {
          const condition = ['idle', 'working'].includes(terminal.status?.state)
            ? ['--if', terminal.status.state]
            : [];
          const result = keys
            ? await hc('keys', address, '--json', ...keys)
            : await hc('send', address, '--json', ...condition, '--', text);
          if (cursor) {
            let acknowledged = false;
            for (let attempt = 0; attempt < 3; attempt++) {
              const current = await hc('get', address, '--json');
              const next = (await sessions([current]))[0];
              if (current.created_ms !== createdMs || next?.sessionId !== data.sessionId) break;
              if (
                next.cursorGeneration &&
                next.cursorGeneration !== match.cursorGeneration &&
                next.cursorPrompt?.trim() === text.trim()
              ) {
                acknowledged = true;
                r.cursorAcknowledged = true;
                break;
              }
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
            }
            r.state = acknowledged ? 'sent' : 'unknown';
          } else r.state = !keys && result.started === false ? 'unknown' : 'sent';
          r.message = r.state === 'unknown' ? 'delivery_uncertain' : 'delivery_sent';
          r.result = result;
        } catch {
          r.state = 'unknown';
          r.message = 'delivery_uncertain';
        }
        r.updatedAt = new Date().toISOString();
        persist();
        return;
      }
      throw new ApiError(404, 'unsupported_request');
    } catch (e) {
      if (!res.headersSent)
        reply(res, e.status || 500, { error: e.status ? e.message : 'server_error' });
    }
  });
  server.once('listening', () => push.start(snapshot, (t) => readInteraction(hc, t, t.sessionId)));
  server.once('close', () => {
    push.stop();
    media.close();
  });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  const push = createPushHub({ folder: config.folder, config: loadPushConfig(config.folder) });
  const server = createBridge({ ...config, push, sessions: createSessionProvider() });
  server.requestTimeout = 20000;
  server.listen(config.port, '127.0.0.1', () =>
    console.log(`Herdr Pocket bridge listening on 127.0.0.1:${config.port}`),
  );
}
