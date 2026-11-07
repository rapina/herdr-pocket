"""Read conversation messages on their owning machine; never return tool output."""
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
from cursor_bridge import read_bindings, process_table, matching_binding


def clean_path(value):
    return (value or '').removeprefix('\\\\?\\')


def basename(value):
    return clean_path(value).replace('\\', '/').rstrip('/').split('/')[-1]


def title_parts(title):
    normalized = re.sub(r'^\[\s*!\s*\]\s*Action Required\s*\|\s*', '', title or '')
    parts = normalized.rsplit(' | ', 1)
    if len(parts) != 2:
        return '', ''
    return re.sub(r'^[\s\u2800-\u28ff✳✻✽·●○▶✓]+', '', parts[0]), parts[1].strip()


def codex_sessions(home):
    rows = []
    names = {}
    index = home / '.codex/session_index.jsonl'
    if index.exists():
        for line in index.read_text(encoding='utf-8').splitlines():
            try:
                item = json.loads(line)
                names[item['id']] = item.get('thread_name')
            except (ValueError, KeyError):
                pass
    databases = sorted((home / '.codex').glob('state_*.sqlite'), key=lambda p: p.stat().st_mtime, reverse=True)
    if databases:
        with sqlite3.connect(databases[0].as_uri() + '?mode=ro', uri=True, timeout=2) as db:
            db.row_factory = sqlite3.Row
            rows = [dict(r) for r in db.execute("select id,name,title,cwd,rollout_path from threads where thread_source='user' and source!='exec' and archived=0")]
    for row in rows:
        row['cwd'] = clean_path(row['cwd'])
        row['names'] = {v for v in [row.get('name'), names.get(row['id']), row.get('title')] if v}
    return rows


def choose_codex(terminal, sessions):
    name, project = title_parts(terminal.get('title'))
    labels = terminal.get('labels') or {}
    candidates = []
    # quad labels survive terminal reuse; require the current title to corroborate them.
    if labels.get('quad.agent') == 'codex' and name:
        candidates = [s for s in sessions if s['id'] == labels.get('quad.session') and name in s['names'] and (not project or basename(s['cwd']).casefold() == project.casefold())]
    if not candidates and name:
        candidates = [s for s in sessions if name in s['names'] and (not project or basename(s['cwd']).casefold() == project.casefold())]
    # Never choose a transcript just because it is the newest in the same folder.
    return candidates[0] if len(candidates) == 1 else None


def parents():
    try:
        if os.name == 'nt':
            command = ['powershell', '-NoProfile', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress']
            result = subprocess.run(command, capture_output=True, text=True, timeout=6, creationflags=0x08000000)
            return {int(p['ProcessId']): int(p['ParentProcessId']) for p in json.loads(result.stdout)}
        result = subprocess.run(['ps', '-axo', 'pid=,ppid='], capture_output=True, text=True, timeout=6)
        return {int(a): int(b) for a, b in (line.split() for line in result.stdout.splitlines())}
    except Exception:
        return {}


def distance(pid, root, tree):
    seen = set()
    while pid and pid not in seen:
        if pid == root:
            return len(seen)
        seen.add(pid)
        pid = tree.get(pid)
    return None


def choose_claude(terminal, sessions, tree):
    matches = []
    for session in sessions:
        depth = distance(session.get('pid'), terminal.get('pid'), tree)
        if depth is not None:
            matches.append((depth, session))
    if matches:
        matches.sort(key=lambda pair: pair[0])
        if len(matches) == 1 or matches[0][0] < matches[1][0]:
            return matches[0][1]
    labels = terminal.get('labels') or {}
    if labels.get('quad.agent') == 'claude':
        candidates = [s for s in sessions if s.get('sessionId') == labels.get('quad.session')]
        if len(candidates) == 1:
            return candidates[0]
    return None


def records(path):
    if not path.exists():
        zipped = pathlib.Path(str(path) + '.zst')
        if not zipped.exists():
            raise FileNotFoundError(path)
        from compression import zstd
        stream = zstd.open(zipped, 'rt', encoding='utf-8')
    else:
        stream = path.open(encoding='utf-8')
    with stream:
        for line in stream:
            try:
                yield json.loads(line)
            except ValueError:
                continue


def recent_records(path):
    with path.open('rb') as stream:
        position = stream.seek(0, 2)
        remainder = b''
        while position:
            size = min(position, 65536)
            position -= size
            stream.seek(position)
            lines = (stream.read(size) + remainder).split(b'\n')
            remainder = lines[0]
            for line in reversed(lines[1:]):
                try:
                    yield json.loads(line)
                except ValueError:
                    pass
        if remainder:
            try:
                yield json.loads(remainder)
            except ValueError:
                pass


def conversation_metadata(path, agent):
    response_at = started_at = None
    reverse = path.exists()
    for event in recent_records(path) if reverse else records(path):
        timestamp = event.get('timestamp')
        if not timestamp:
            continue
        data = (event.get('payload') if agent == 'codex' else event.get('message')) or {}
        if agent == 'codex':
            if event.get('type') == 'event_msg' and data.get('type') == 'task_started' and (started_at is None or not reverse):
                started_at = timestamp
            if event.get('type') == 'event_msg' and data.get('type') == 'item_completed':
                data = data.get('item') or {}
                if data.get('type') != 'AgentMessage':
                    continue
                role = 'assistant'
            elif event.get('type') == 'event_msg' and data.get('type') == 'agent_message':
                data = {**data, 'content': data.get('message', '')}
                role = 'assistant'
            elif event.get('type') == 'response_item' and data.get('type') == 'message':
                role = data.get('role')
            else:
                continue
        else:
            if event.get('isSidechain') or event.get('isMeta') or event.get('type') not in ('user', 'assistant'):
                continue
            role = data.get('role') or event['type']
        text = text_blocks(data.get('content'))
        if role == 'assistant' and (response_at is None or not reverse) and text.strip() and data.get('phase') not in ('analysis', 'reasoning') and data.get('channel') not in ('analysis', 'reasoning'):
            response_at = timestamp
        if agent != 'codex' and role == 'user' and (started_at is None or not reverse) and visible_user(text):
            started_at = timestamp
        if reverse and response_at and started_at:
            break
    return {'lastResponseAt': response_at, 'turnStartedAt': started_at}


def text_blocks(content):
    if isinstance(content, str):
        return content
    chunks = []
    for part in content or []:
        if part.get('type') in ('text', 'input_text', 'output_text'):
            chunks.append(part.get('text', ''))
        elif part.get('type') in ('image', 'input_image'):
            chunks.append('[Image]')
    return '\n'.join(chunks)


def visible_user(text, metadata=None):
    kinds = (metadata or {}).get('content_item_kinds')
    if kinds and not any(k.startswith('user.') for k in kinds):
        return False
    hidden = ('# AGENTS.md instructions', '<environment_context>', '<turn_aborted>', '<user_instructions>', '<system-reminder>', '<local-command', '<command-name>', '<task-notification>', '<reason-message', '[Request interrupted', 'This session is being continued from a previous conversation')
    return bool(text.strip()) and not text.lstrip().startswith(hidden)


def cursor_user_text(text):
    query = re.search(r'<user_query>\s*([\s\S]*?)\s*</user_query>', text)
    if query: text = query.group(1)
    wrapped = re.fullmatch(r'\s*<hc\b[^>]*>([\s\S]*)</hc>\s*', text)
    return wrapped.group(1).strip() if wrapped else text.strip()


def tool_label(name):
    name = (name or '').lower()
    if any(word in name for word in ('exec_command', 'shell', 'bash', 'commandexecution')):
        return 'activity_command'
    if any(word in name for word in ('apply_patch', 'filechange', 'edit', 'write')):
        return 'activity_edit'
    if any(word in name for word in ('search', 'web', 'browse')):
        return 'search'
    if any(word in name for word in ('read', 'view', 'get_file')):
        return 'activity_read'
    return 'activity_tool'


def read_conversation(path, agent, before=None):
    messages = []
    seen = set()
    active_tools = {}
    activity = None
    for ordinal, event in enumerate(records(path)):
        timestamp = event.get('timestamp')
        if agent == 'cursor':
            data = event.get('message') or {}
            role = event.get('role') or data.get('role')
            if event.get('isSidechain') or event.get('isMeta') or data.get('phase') in ('analysis', 'reasoning') or data.get('channel') in ('analysis', 'reasoning'):
                continue
            text = text_blocks(data.get('content'))
            if role == 'user':
                text = cursor_user_text(text)
                if not visible_user(text): continue
            key = event.get('id') or 'cursor-' + str(ordinal)
            phase = None
        elif agent == 'codex':
            data = event.get('payload') or {}
            kind = data.get('type')
            if event.get('type') == 'event_msg':
                item = data.get('item') or {}
                if kind in ('task_started', 'task_complete', 'turn_aborted'):
                    active_tools.clear()
                    activity = None
                if kind == 'item_completed' and item.get('type') == 'CommandExecution':
                    activity = {'label': 'activity_command', 'state': 'completed', 'timestamp': timestamp}
                if kind == 'item_completed' and item.get('type') == 'AgentMessage':
                    data = {**item, 'type': 'message', 'role': 'assistant'}
                elif kind == 'agent_message':
                    data = {'type': 'message', 'role': 'assistant', 'content': data.get('message', ''), 'id': data.get('id'), 'phase': data.get('phase')}
                else:
                    continue
            elif event.get('type') != 'response_item':
                continue
            kind = data.get('type')
            if kind in ('function_call', 'custom_tool_call'):
                call_id = data.get('call_id') or data.get('id') or str(ordinal)
                activity = {'label': tool_label(data.get('name')), 'state': 'running', 'timestamp': timestamp}
                active_tools[call_id] = activity
                continue
            if kind in ('function_call_output', 'custom_tool_call_output'):
                completed = active_tools.pop(data.get('call_id'), None)
                if active_tools:
                    activity = next(reversed(active_tools.values()))
                elif completed:
                    activity = {**completed, 'state': 'completed', 'timestamp': timestamp}
                continue
            if kind != 'message':
                continue
            role = data.get('role')
            if data.get('phase') in ('analysis', 'reasoning') or data.get('channel') in ('analysis', 'reasoning'):
                continue
            text = text_blocks(data.get('content'))
            if role == 'user' and not visible_user(text, data.get('internal_chat_message_metadata_passthrough')):
                continue
            key = data.get('id') or str(ordinal)
            phase = data.get('phase')
        else:
            if event.get('isSidechain') or event.get('isMeta') or event.get('type') not in ('user', 'assistant'):
                continue
            data = event.get('message') or {}
            role = data.get('role') or event['type']
            content = data.get('content')
            for part in content if isinstance(content, list) else []:
                if part.get('type') == 'tool_use':
                    activity = {'label': tool_label(part.get('name')), 'state': 'running', 'timestamp': timestamp}
                    active_tools[part.get('id')] = activity
                elif part.get('type') == 'tool_result':
                    completed = active_tools.pop(part.get('tool_use_id'), None)
                    if active_tools:
                        activity = next(reversed(active_tools.values()))
                    elif completed:
                        activity = {**completed, 'state': 'completed', 'timestamp': timestamp}
            text = text_blocks(content)
            if role == 'user' and not visible_user(text):
                continue
            key = event.get('uuid') or str(ordinal)
            phase = None
        if role not in ('user', 'assistant') or not text.strip() or key in seen:
            continue
        seen.add(key)
        if role == 'user':
            active_tools.clear()
            activity = None
        elif phase in ('final', 'final_answer'):
            active_tools.clear()
            activity = None
        # Some Codex versions persist both an event and a response item without a shared ID.
        if messages and role == 'assistant' and messages[-1]['role'] == role and messages[-1]['text'] == text:
            continue
        messages.append({'id': key, 'ordinal': ordinal, 'role': role, 'text': text, 'phase': phase, 'timestamp': timestamp})
    eligible = [m for m in messages if before is None or m['ordinal'] < before]
    page = eligible[-60:]
    budget = 360000
    result = []
    for message in reversed(page):
        message['text'] = message['text'][:100000]
        if result and len(message['text']) > budget:
            break
        result.append(message)
        budget -= len(message['text'])
    result.reverse()
    return {'messages': result, 'hasMore': len(eligible) > len(result), 'before': result[0]['ordinal'] if result else None, 'activity': activity}


def collect(request, home=None):
    home = home or pathlib.Path.home()
    terminals = request.get('terminals', [])
    bindings = read_bindings(home)
    try:
        cursor_processes = process_table() if bindings else {}
    except Exception:
        cursor_processes = {}
    codex = []
    try:
        if any((t.get('status') or {}).get('app') == 'codex' for t in terminals):
            codex = codex_sessions(home)
    except Exception:
        pass
    claude = []
    tree = {}
    if any((t.get('status') or {}).get('app') in ('claude', 'claude-code') for t in terminals):
        for path in (home / '.claude/sessions').glob('*.json'):
            try:
                claude.append(json.loads(path.read_text(encoding='utf-8')))
            except (ValueError, OSError):
                pass
        tree = parents()
    result = []
    for terminal in terminals:
        cursor = matching_binding(terminal, bindings, cursor_processes)
        if cursor:
            sid = cursor['sessionId']
            item = {'address': terminal['address'], 'agent': 'cursor', 'sessionId': sid,
                    'project': basename(cursor['cwd']), 'workingCwd': cursor['cwd'],
                    'sessionTitle': terminal.get('title') or 'Cursor', 'cursorState': cursor['state'],
                    'cursorGeneration': cursor.get('generation'), 'cursorPrompt': cursor_user_text(cursor.get('prompt', '')),
                    'lastResponseAt': cursor.get('replyAt'), 'turnStartedAt': cursor.get('promptAt'),
                    'conversation': {'messages': [], 'hasMore': False}}
            if request.get('conversationFor') == terminal['address']:
                try:
                    if cursor.get('transcript'):
                        path = pathlib.Path(cursor['transcript']).resolve()
                        if not path.is_relative_to((home / '.cursor/projects').resolve()) or path.name != sid + '.jsonl' or 'agent-transcripts' not in path.parts:
                            raise ValueError('Outside Cursor transcripts')
                        item['conversation'] = read_conversation(path, 'cursor', request.get('before'))
                    chat = item['conversation']
                    if request.get('before') is None:
                        for message in reversed(chat['messages']):
                            if message['role'] == 'assistant' and not message.get('timestamp'):
                                message['timestamp'] = cursor.get('replyAt'); break
                        activity = cursor.get('activity')
                        chat['activity'] = {'label': tool_label(activity['name']), 'state': activity['state'], 'timestamp': activity['timestamp']} if activity else None
                except Exception:
                    item['conversation'] = {'messages': [], 'hasMore': False, 'unavailable': 'transcript_unavailable'}
            result.append(item)
            continue
        app = (terminal.get('status') or {}).get('app', '')
        title, project = title_parts(terminal.get('title')) if app == 'codex' else ('', '')
        item = {'address': terminal['address'], 'project': project or basename(terminal.get('cwd')), 'sessionTitle': title, 'conversation': {'messages': [], 'hasMore': False, 'unavailable': 'session_unavailable'}}
        session = choose_codex(terminal, codex) if app == 'codex' else choose_claude(terminal, claude, tree) if app in ('claude', 'claude-code') else None
        if session:
            sid = session.get('id') or session['sessionId']
            cwd = clean_path(session.get('cwd'))
            item.update(project=basename(cwd), workingCwd=cwd, sessionId=sid, sessionTitle=title or session.get('name') or session.get('title') or '')
            item['conversation'] = {'messages': [], 'hasMore': False}
            try:
                if app == 'codex':
                    path = pathlib.Path(session['rollout_path'])
                    allowed = home / '.codex/sessions'
                else:
                    path = next((home / '.claude/projects').glob('*/' + sid + '.jsonl'))
                    allowed = home / '.claude/projects'
                if not path.resolve().is_relative_to(allowed.resolve()):
                    raise ValueError('Outside session directory')
                item.update(conversation_metadata(path, app))
                if request.get('conversationFor') == terminal['address']:
                    item['conversation'] = read_conversation(path, app, request.get('before'))
            except Exception:
                item['conversation'] = {'messages': [], 'hasMore': False, 'unavailable': 'transcript_unavailable'}
        result.append(item)
    return result


if __name__ == '__main__':
    sys.stdin.reconfigure(encoding='utf-8')
    request = json.load(sys.stdin)
    print(json.dumps(collect(request), ensure_ascii=True))
