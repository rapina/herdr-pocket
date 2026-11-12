"""Read a bounded media file named in a session's messages, over hc stdin/stdout."""
import json
import os
import stat
import sys
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


def is_network_path(path):
    text = str(path).replace('\\', '/')
    return text.startswith('//') and not text.startswith(('//?/', '//./')) or text.startswith(('//?/UNC/', '//./UNC/'))


def open_media(data):
    # The bridge only issues IDs for paths that appear in the session's messages.
    # Any local file is allowed as long as its signature is a supported media type.
    requested = data['path']
    # Opening a network share can send Windows credentials to that host.
    if '\x00' in requested or is_network_path(requested): raise ValueError('media_forbidden')
    path = Path(requested)
    if requested.startswith(('~/', '~\\')): path = Path.home() / requested[2:]
    if not path.is_absolute():
        root = Path(data['root'])
        if not root.is_absolute(): raise ValueError('media_forbidden')
        path = root / path
    if is_network_path(path): raise ValueError('media_forbidden')
    path = path.resolve(strict=True)
    if is_network_path(path) or not path.is_file(): raise ValueError('media_forbidden')
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
