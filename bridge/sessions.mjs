import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./session_reader.py', import.meta.url), 'utf8');
const cursorSource = readFileSync(new URL('./cursor_bridge.py', import.meta.url), 'utf8');
const bootstrap = `import json,sys,types;sys.stdin.reconfigure(encoding='utf-8');data=json.load(sys.stdin);m=types.ModuleType('cursor_bridge');sys.modules['cursor_bridge']=m;exec(compile(data['cursorSource'],'pocket-cursor','exec'),m.__dict__);scope={'__name__':'pocket_reader'};exec(compile(data['source'],'pocket-session-reader','exec'),scope);sys.stdout.reconfigure(encoding='utf-8');print(json.dumps(scope['collect'](data['request']),ensure_ascii=False))`;

export function displayTerminal(terminal, session = {}) {
  const app = session.agent || terminal.status?.app || terminal.agent;
  // Claude Code ends its turn while a background command runs; Herdr then reports
  // done or idle even though work continues until the command finishes.
  const background =
    session.claudeStatus === 'shell' && ['done', 'idle'].includes(terminal.status?.state);
  const title = (terminal.title || '').replace(/^\[\s*!\s*\]\s*Action Required\s*\|\s*/, '');
  const parts = app === 'codex' ? title.split(' | ') : [];
  const folder = parts.length > 1 ? parts.at(-1) : null;
  return {
    ...terminal,
    agent: app,
    ...(session.agent === 'cursor'
      ? { status: { app: 'cursor', state: session.cursorState || 'unknown' } }
      : {}),
    project:
      session.project ||
      folder ||
      terminal.cwd?.replaceAll('\\', '/').split('/').filter(Boolean).at(-1),
    sessionTitle:
      session.sessionTitle ||
      (parts.length > 1
        ? parts
            .slice(0, -1)
            .join(' | ')
            .replace(/^[\s\u2800-\u28ff]+/, '')
        : ''),
    ...(session.workingCwd ? { cwd: session.workingCwd } : {}),
    sessionId: session.sessionId || null,
    lastResponseAt: session.lastResponseAt || null,
    lastResponseText: session.lastResponseText || '',
    background,
    workingSince: background
      ? session.claudeStatusAt
        ? new Date(session.claudeStatusAt).toISOString()
        : null
      : (session.cursorState || terminal.status?.state) === 'working'
        ? session.turnStartedAt || terminal.status_ms || null
        : null,
  };
}

export function createSessionProvider(binary = process.env.HC_PATH || 'hc') {
  return async (terminals, conversationFor, before) => {
    const groups = new Map();
    for (const t of terminals) {
      const machine = t.address.includes('/') ? t.address.split('/')[0] : '';
      if (!groups.has(machine)) groups.set(machine, []);
      groups.get(machine).push(t);
    }
    const result = await Promise.all(
      [...groups].map(async ([machine, group]) => {
        const input = JSON.stringify({
          source,
          cursorSource,
          request: { terminals: group, conversationFor, before },
        });
        for (const python of ['python', 'python3']) {
          try {
            const data = await new Promise((resolve, reject) => {
              const env = { ...process.env };
              delete env.HC_TERMINAL_ID;
              const args = [
                'exec',
                ...(machine ? ['--on', machine] : []),
                '--timeout',
                '12',
                '-i',
                '--',
                python,
                '-c',
                bootstrap,
              ];
              const child = execFile(
                binary,
                args,
                {
                  env,
                  windowsHide: true,
                  timeout: 15000,
                  maxBuffer: 6 * 1024 * 1024,
                  encoding: 'utf8',
                },
                (error, stdout) => {
                  if (error) return reject(error);
                  try {
                    resolve(JSON.parse(stdout.replace(/^\uFEFF/, '')));
                  } catch (e) {
                    reject(e);
                  }
                },
              );
              child.stdin.on('error', () => {});
              child.stdin.end(input);
            });
            return data;
          } catch {}
        }
        return group.map((t) => ({
          address: t.address,
          conversation: { messages: [], hasMore: false, unavailable: 'session_connection_failed' },
        }));
      }),
    );
    return result.flat();
  };
}
