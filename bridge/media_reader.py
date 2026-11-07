"""Read a bounded media file inside the matched session workspace, over hc stdin/stdout."""
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path

LIMIT = 128 * 1024 * 1024


def media_type(head, suffix):
    if head.startswith(b'\x89PNG\r\n\x1a\n'): return 'image/png'
    if head.startswith(b'\xff\xd8\xff'): return 'image/jpeg'
    if head.startswith((b'GIF87a', b'GIF89a')): return 'image/gif'
    if head[:4] == b'RIFF' and head[8:12] == b'WEBP': return 'image/webp'
    if head[:2] == b'BM': return 'image/bmp'
    if head[:4] == b'RIFF' and head[8:12] == b'WAVE': return 'audio/wav'
    if head.startswith(b'fLaC'): return 'audio/flac'
    if head.startswith(b'OggS'): return 'video/ogg' if suffix == '.ogv' else 'audio/ogg'
    if head.startswith(b'\x1aE\xdf\xa3'): return 'audio/webm' if suffix == '.weba' else 'video/webm'
    if head[4:8] == b'ftyp':
        if head[8:12] in (b'avif', b'avis'): return 'image/avif'
        return 'audio/mp4' if suffix == '.m4a' else 'video/mp4'
    if suffix == '.mp3' and (head.startswith(b'ID3') or (len(head) > 1 and head[0] == 255 and head[1] & 224 == 224)):
        return 'audio/mpeg'
    if suffix == '.aac' and len(head) > 1 and head[0] == 255 and head[1] & 246 == 240: return 'audio/aac'
    raise ValueError('media_unsupported')


def open_media(data):
    root = Path(data['root']).resolve(strict=True)
    requested = data['path']
    if not root.is_dir() or root == Path(root.anchor) or '\x00' in requested:
        raise ValueError('media_forbidden')
    path = Path(requested)
    if not path.is_absolute(): path = root / path
    path = path.resolve(strict=True)
    boundary = root
    if not path.is_relative_to(root):
        session = data.get('sessionId', '')
        base = (Path(tempfile.gettempdir()) / 'claude').resolve()
        if data.get('agent') not in ('claude', 'claude-code') or not re.fullmatch(r'[a-fA-F0-9-]{36}', session) or not path.is_relative_to(base):
            raise ValueError('media_forbidden')
        parts = path.relative_to(base).parts
        if len(parts) < 4 or not re.fullmatch(r'[a-fA-F0-9]{8,64}', parts[0]) or parts[1] != session or parts[2] != 'scratchpad':
            raise ValueError('media_forbidden')
        boundary = base / parts[0] / session / 'scratchpad'
    # Hidden configuration folders and credential files are never media sources.
    if any(p.startswith('.') for p in path.relative_to(boundary).parts):
        raise ValueError('media_forbidden')
    if not path.is_file(): raise ValueError('media_forbidden')
    stream = open(path, 'rb')
    try:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode): raise ValueError('media_forbidden')
        if info.st_size < 1 or info.st_size > LIMIT: raise ValueError('media_too_large')
        mime = media_type(stream.read(64), path.suffix.lower())
        stream.seek(0)
        return stream, {'size': info.st_size, 'mime': mime}
    except Exception:
        stream.close()
        raise


def main():
    try:
        data = json.load(sys.stdin)
        stream, metadata = open_media(data)
        with stream:
            sys.stdout.buffer.write((json.dumps(metadata) + '\n').encode())
            left = metadata['size']
            while left:
                chunk = stream.read(min(left, 256 * 1024))
                if not chunk: raise ValueError('media_changed')
                sys.stdout.buffer.write(chunk)
                left -= len(chunk)
    except Exception as error:
        code = str(error) if str(error).startswith('media_') else 'media_missing'
        sys.stdout.buffer.write((json.dumps({'error': code}) + '\n').encode())


if __name__ == '__main__': main()
