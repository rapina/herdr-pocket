import { randomUUID, createHash, sign } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const uuid = /^[a-f0-9-]{36}$/;
const identity = (t) => JSON.stringify([t.address, t.created_ms, t.sessionId]);
const digest = (v) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fault = (status, message) => Object.assign(new Error(message), { status });
const read = (path) => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));

export function notificationPreview(value) {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  let preview = '',
    bytes = 0;
  for (const character of text) {
    const size = Buffer.byteLength(JSON.stringify(character)) - 2;
    if (bytes + size > 1997) return preview + '…';
    preview += character;
    bytes += size;
  }
  return preview;
}

export function loadPushConfig(folder, env = process.env) {
  const clientPath = env.POCKET_FIREBASE_CLIENT_CONFIG || resolve(folder, 'google-services.json');
  const accountPath =
    env.POCKET_FIREBASE_SERVICE_ACCOUNT || resolve(folder, 'firebase-service-account.json');
  if (!existsSync(clientPath) || !existsSync(accountPath)) return null;
  const client = read(clientPath),
    account = read(accountPath);
  const app = client.client?.find(
    (c) => c.client_info?.android_client_info?.package_name === 'dev.rapina.herdrpocket',
  );
  const options = {
    projectId: client.project_info?.project_id,
    senderId: client.project_info?.project_number,
    appId: app?.client_info?.mobilesdk_app_id,
    apiKey: app?.api_key?.[0]?.current_key,
  };
  if (
    Object.values(options).some((v) => typeof v !== 'string' || !v) ||
    account.project_id !== options.projectId ||
    !account.private_key ||
    !account.client_email
  )
    throw Error('Invalid or mismatched Firebase configuration');
  return { options, account };
}

export function createFcmSender({ account, options }, fetcher = fetch) {
  let access,
    expires = 0;
  async function token() {
    if (access && Date.now() < expires) return access;
    const now = Math.floor(Date.now() / 1000);
    const encoded = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const input = `${encoded({ alg: 'RS256', typ: 'JWT' })}.${encoded({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const assertion = `${input}.${sign('RSA-SHA256', Buffer.from(input), account.private_key).toString('base64url')}`;
    const response = await fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) throw Error('push_auth_failed');
    access = data.access_token;
    expires = Date.now() + Math.max(0, (Number(data.expires_in) - 120) * 1000);
    return access;
  }
  return async (deviceToken, event) => {
    const response = await fetcher(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(options.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token: deviceToken,
            data: {
              eventId: event.id,
              sessionKey: event.key,
              kind: event.kind,
              createdAt: String(event.at),
              ...(event.kind === 'done' && event.preview
                ? { preview: notificationPreview(event.preview) }
                : {}),
            },
            android: {
              priority: 'HIGH',
              ttl: '900s',
            },
          },
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (response.ok) return;
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      access = null;
      expires = 0;
    }
    const invalid = data.error?.details?.some((d) => d.errorCode === 'UNREGISTERED');
    throw Object.assign(Error('push_send_failed'), { invalidToken: invalid });
  };
}

export function createPushHub({
  folder,
  config = null,
  send = config && createFcmSender(config),
  now = Date.now,
}) {
  const path = folder && resolve(folder, 'push-state.json');
  const data = path && existsSync(path) ? read(path) : { devices: {}, routes: {}, pending: [] };
  const save = () => {
    if (!path) return;
    mkdirSync(folder, { recursive: true });
    writeFileSync(`${path}.tmp`, JSON.stringify(data), { mode: 0o600 });
    renameSync(`${path}.tmp`, path);
  };
  let timer,
    busy = false,
    stopped = false;
  const route = (t) => {
    if (!t.sessionId || t.unavailable || t.state !== 'live') return null;
    const key = identity(t);
    if (!data.routes[key]) {
      data.routes[key] = {
        key: randomUUID(),
        address: t.address,
        sessionId: t.sessionId,
        createdMs: t.created_ms,
        seenAt: now(),
      };
      save();
    }
    return data.routes[key];
  };
  const decorate = (t) => ({ ...t, notificationKey: route(t)?.key || null });
  const options = () => ({ available: !!config, ...(config ? { firebase: config.options } : {}) });
  const register = (body) => {
    if (!config) throw fault(503, 'push_not_configured');
    if (
      !uuid.test(body.id || '') ||
      typeof body.token !== 'string' ||
      !/^[\w:.-]{40,4096}$/.test(body.token)
    )
      throw fault(400, 'invalid_push_device');
    if (!data.devices[body.id] && Object.keys(data.devices).length >= 20)
      throw fault(409, 'push_device_limit');
    data.devices[body.id] = { token: body.token, seenAt: now() };
    save();
    return { enabled: true };
  };
  const remove = (id) => {
    if (!uuid.test(id || '')) throw fault(400, 'invalid_push_device');
    delete data.devices[id];
    data.pending = data.pending.filter((p) => p.device !== id);
    save();
    return { enabled: false };
  };
  const resolveKey = (key, terminals) => {
    if (!uuid.test(key || '')) throw fault(400, 'invalid_push_event');
    const t = terminals.find(
      (t) =>
        data.routes[identity(t)]?.key === key &&
        t.state === 'live' &&
        !t.unavailable &&
        t.sessionId,
    );
    if (!t) throw fault(410, 'push_session_expired');
    return { address: t.address };
  };
  const observe = (terminals) => {
    for (const t of terminals) {
      const r = route(t),
        state = t.status?.state;
      if (!r || !['working', 'blocked', 'idle', 'done', 'error', 'failed'].includes(state))
        continue;
      const response = t.lastResponseAt || null;
      const prompt = t.pushPrompt || null;
      const before = now() - r.seenAt < 900000 ? r.observed : null;
      let kind;
      if (before) {
        if (
          state === 'blocked' &&
          (before.state !== 'blocked' || (prompt && before.prompt && prompt !== before.prompt))
        )
          kind = 'input';
        else if (['error', 'failed'].includes(state) && before.state !== state) kind = 'error';
        else if (
          ['idle', 'done'].includes(state) &&
          response &&
          response !== before.completed &&
          (before.state === 'working' || before.state === 'blocked' || response !== before.response)
        )
          kind = 'done';
      }
      r.observed = {
        state,
        response,
        prompt: prompt || (state === 'blocked' ? before?.prompt : null),
        completed: kind === 'done' || !before ? response : before.completed,
      };
      r.seenAt = now();
      if (state === 'working' || kind)
        data.pending = data.pending.filter((p) => p.event.key !== r.key);
      if (kind) {
        const event = {
          id: randomUUID(),
          key: r.key,
          kind,
          at: now(),
          ...(kind === 'done' ? { preview: notificationPreview(t.lastResponseText) } : {}),
        };
        for (const device of Object.keys(data.devices))
          data.pending.push({ device, event, attempts: 0, next: now() });
      }
    }
    for (const [key, r] of Object.entries(data.routes))
      if (now() - r.seenAt > 7 * 86400000) delete data.routes[key];
    for (const [id, d] of Object.entries(data.devices))
      if (now() - d.seenAt > 30 * 86400000) delete data.devices[id];
    data.pending = data.pending
      .filter((p) => data.devices[p.device] && now() - p.event.at < 900000)
      .slice(-200);
    save();
  };
  const flush = async () => {
    if (!send) return;
    for (const p of [...data.pending]) {
      if (p.next > now() || !data.devices[p.device]) continue;
      try {
        await send(data.devices[p.device].token, p.event);
        data.pending = data.pending.filter((item) => item !== p);
      } catch (e) {
        if (e.invalidToken) remove(p.device);
        else {
          p.attempts++;
          p.next = now() + Math.min(300000, 5000 * 2 ** Math.min(6, p.attempts));
        }
      }
      save();
    }
  };
  const tick = async (snapshot, interaction) => {
    if (busy || stopped || !config || !Object.keys(data.devices).length) return;
    busy = true;
    try {
      const { terminals } = await snapshot();
      const projected = [];
      for (const t of terminals) {
        let prompt;
        if (t.status?.state === 'blocked' && t.sessionId && interaction) {
          try {
            const q = await interaction(t);
            if (q) prompt = digest([q.kind, q.question, q.choices]);
          } catch {}
        }
        projected.push({ ...t, pushPrompt: prompt });
      }
      observe(projected);
      await flush();
    } catch {
      /* The next poll retries without interpreting connection loss as agent failure. */
    } finally {
      busy = false;
    }
  };
  return {
    options,
    register,
    remove,
    resolveKey,
    decorate,
    observe,
    flush,
    tick,
    start(snapshot, interaction) {
      if (!config || timer) return;
      stopped = false;
      const run = async () => {
        await tick(snapshot, interaction);
        if (!stopped) {
          timer = setTimeout(run, 8000);
          timer.unref();
        }
      };
      void run();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
    },
  };
}
