"""Cursor CLI hook registration bound to a live Herdr terminal and agent process."""
import datetime
import base64
import json
import os
import pathlib
import re
import shlex
import sqlite3
import subprocess
import sys

EVENTS = ['sessionStart', 'sessionEnd', 'beforeSubmitPrompt', 'afterAgentResponse',
          'preToolUse', 'postToolUse', 'postToolUseFailure', 'stop']


def process_table():
    if os.name == 'nt':
        script = r'''Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{pid=$_.ProcessId; parent=$_.ParentProcessId; started=$_.CreationDate.ToUniversalTime().ToString('o'); cursor=[bool](($_.Name -match '^(node|cursor-agent)(\.exe)?$') -and ($_.CommandLine -match '[\\/]cursor-agent[\\/].*index\.js|cursor-agent(\.exe)?"?\s'))} } | ConvertTo-Json -Compress'''
        result = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, text=True, timeout=6, creationflags=0x08000000)
        return {int(row['pid']): row for row in json.loads(result.stdout or '[]')}
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,lstart=,args='], capture_output=True, text=True, timeout=6)
    rows = {}
    for line in result.stdout.splitlines():
        parts = line.split(None, 7)
        if len(parts) != 8: continue
        command = parts[7]
        rows[int(parts[0])] = {'parent': int(parts[1]), 'started': ' '.join(parts[2:7]),
                              'cursor': bool(re.search(r'/cursor-agent/.*index\.js|(?:^|/)cursor-agent(?:\s|$)', command))}
    return rows


def ancestor(pid, root, table):
    seen = set()
    while pid and pid not in seen:
        if pid == root: return True
        seen.add(pid)
        pid = table.get(pid, {}).get('parent')
    return False


def storage(home):
    return pathlib.Path(home) / '.cursor/herdr-pocket/sessions.sqlite'


def read_bindings(home):
    path = storage(home)
    if not path.exists(): return {}
    try:
        with sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=1) as db:
            return {key: json.loads(value) for key, value in db.execute('select terminal,data from bindings')}
    except (sqlite3.Error, ValueError): return {}


def matching_binding(terminal, bindings, table):
    local_id = terminal['address'].rsplit('/', 1)[-1]
    binding = bindings.get(local_id)
    if not binding or binding.get('ended') or terminal.get('state') != 'live': return None
    if binding.get('terminalCreated') != terminal.get('created_ms') or binding.get('terminalPid') != terminal.get('pid'): return None
    process = table.get(binding.get('agentPid'), {})
    if not process.get('cursor') or process.get('started') != binding.get('agentStarted'): return None
    if not ancestor(binding['agentPid'], terminal['pid'], table): return None
    return binding


def timestamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def apply_event(previous, event, identity, at):
    same = previous.get('sessionId') == identity['sessionId'] and previous.get('agentPid') == identity['agentPid'] and previous.get('agentStarted') == identity['agentStarted']
    value = dict(previous) if same else {'state': 'idle'}
    kind = event['hook_event_name']
    if same and kind not in ('beforeSubmitPrompt', 'sessionStart', 'sessionEnd') and value.get('generation') and event.get('generation_id') and value['generation'] != event['generation_id']:
        return value
    value.update(identity)
    if event.get('transcript_path'): value['transcript'] = event['transcript_path']
    if kind == 'beforeSubmitPrompt':
        value.update(state='working', prompt=str(event.get('prompt', ''))[:100000],
                     generation=event.get('generation_id'), promptAt=at, activity=None, ended=False)
    elif kind == 'afterAgentResponse':
        value.update(reply=str(event.get('text', ''))[:100000], replyAt=at)
    elif kind in ('preToolUse', 'postToolUse', 'postToolUseFailure'):
        value.update(activity={'name': str(event.get('tool_name', ''))[:100],
                              'state': 'running' if kind == 'preToolUse' else 'completed', 'timestamp': at})
    elif kind == 'stop':
        value.update(state={'completed': 'done', 'aborted': 'idle', 'error': 'error'}.get(event.get('status'), 'idle'), activity=None)
    elif kind == 'sessionEnd': value.update(ended=True, state='idle', activity=None)
    # sessionStart can finish after beforeSubmitPrompt; never reset an existing turn.
    value['seenAt'] = at
    return value


def hook(event, home=None):
    home = pathlib.Path(home or pathlib.Path.home())
    terminal_id = os.environ.get('HC_TERMINAL_ID', '')
    session_id = event.get('conversation_id') or event.get('session_id') or ''
    if not re.fullmatch(r't[a-z0-9]+', terminal_id) or not re.fullmatch(r'[a-fA-F0-9-]{36}', session_id): return
    if event.get('hook_event_name') not in EVENTS or event.get('is_background_agent'): return
    at = timestamp()
    table = process_table()
    chain, pid, seen = [], os.getppid(), set()
    while pid and pid not in seen:
        seen.add(pid)
        row = table.get(pid, {})
        if row.get('cursor'): chain.append(pid)
        pid = row.get('parent')
    if len(chain) != 1: return
    options = {'creationflags': 0x08000000} if os.name == 'nt' else {}
    result = subprocess.run(['hc', 'get', terminal_id, '--json'], capture_output=True, text=True, encoding='utf-8', timeout=3, **options)
    terminal = json.loads(result.stdout)
    if terminal.get('state') != 'live' or not ancestor(chain[0], terminal.get('pid'), table): return
    roots = event.get('workspace_roots') or []
    if not roots or not pathlib.Path(roots[0]).is_absolute(): return
    identity = {'sessionId': session_id, 'terminalCreated': terminal['created_ms'], 'terminalPid': terminal['pid'],
                'agentPid': chain[0], 'agentStarted': table[chain[0]]['started'], 'cwd': roots[0]}
    path = storage(home)
    path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(path, timeout=4) as db:
        db.execute('create table if not exists bindings (terminal text primary key, data text not null)')
        db.execute('begin immediate')
        row = db.execute('select data from bindings where terminal=?', (terminal_id,)).fetchone()
        value = apply_event(json.loads(row[0]) if row else {}, event, identity, at)
        db.execute('insert or replace into bindings values (?,?)', (terminal_id, json.dumps(value)))


def install(source, home=None):
    home = pathlib.Path(home or pathlib.Path.home())
    directory = home / '.cursor/herdr-pocket'
    path = home / '.cursor/hooks.json'
    original = path.read_text(encoding='utf-8-sig') if path.exists() else None
    config = json.loads(original) if original is not None else {'version': 1, 'hooks': {}}
    hooks = config.setdefault('hooks', {})
    if not isinstance(hooks, dict): raise ValueError('Unsupported Cursor hooks configuration')
    script = directory / 'cursor_bridge.py'
    if os.name == 'nt':
        invoke = '& ' + ' '.join("'" + value.replace("'", "''") + "'" for value in (sys.executable, str(script)))
        command = 'powershell -NoProfile -NonInteractive -EncodedCommand ' + base64.b64encode(invoke.encode('utf-16-le')).decode()
    else:
        command = shlex.join([sys.executable, str(script)])
    for event in EVENTS:
        entries = hooks.setdefault(event, [])
        if not isinstance(entries, list): raise ValueError('Unsupported Cursor hook entry')
        hooks[event] = [entry for entry in entries if entry.get('command') != command and str(script) not in entry.get('command', '')] + [{'command': command, 'timeout': 15}]
    directory.mkdir(parents=True, exist_ok=True)
    backup = directory / 'hooks.before-pocket.json'
    if original is not None and not backup.exists(): backup.write_text(original, encoding='utf-8')
    script.write_text(source, encoding='utf-8')
    temporary = path.with_name('hooks.pocket.tmp')
    temporary.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(path)
    return {'installed': True, 'hooks': len(EVENTS)}


if __name__ == '__main__':
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        hook(json.load(sys.stdin))
    except Exception:
        pass
    print('{}')
