import importlib.util
import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

spec = importlib.util.spec_from_file_location('media_reader', Path(__file__).parents[1] / 'bridge/media_reader.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaReaderTests(unittest.TestCase):
    def test_claude_scratchpad_is_bound_to_the_current_session(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(media.tempfile, 'gettempdir', return_value=tmp):
            parent = Path(tmp)
            root = parent / 'workspace'
            root.mkdir()
            session = '11111111-1111-1111-1111-111111111111'
            scratch = parent / 'claude/0123456789abcdef' / session / 'scratchpad'
            scratch.mkdir(parents=True)
            image = scratch / 'preview.png'
            image.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\0' * 64)
            data = dict(root=str(root), path=str(image), agent='claude', sessionId=session)
            stream, info = media.open_media(data)
            with stream: self.assertEqual(info['mime'], 'image/png')
            for changed in [dict(sessionId='22222222-2222-2222-2222-222222222222'), dict(agent='cursor'), dict(sessionId='')]:
                with self.assertRaisesRegex(ValueError, 'media_forbidden'):
                    media.open_media({**data, **changed})
            hidden = scratch / '.private.png'
            hidden.write_bytes(image.read_bytes())
            with self.assertRaisesRegex(ValueError, 'media_forbidden'):
                media.open_media({**data, 'path': str(hidden)})

    def test_workspace_boundary_hidden_files_and_content_type(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            root = parent / 'workspace'
            root.mkdir()
            image = root / 'render.png'
            image.write_bytes(b'\x89PNG\r\n\x1a\n' + b'\0' * 64)
            stream, info = media.open_media({'root': str(root), 'path': 'render.png'})
            with stream:
                self.assertEqual(info['mime'], 'image/png')
                self.assertEqual(len(stream.read()), info['size'])
            outside = parent / 'secret.png'
            outside.write_bytes(image.read_bytes())
            hidden = root / '.private'
            hidden.mkdir()
            (hidden / 'secret.png').write_bytes(image.read_bytes())
            for path in [str(outside), '../secret.png', '.private/secret.png', str(root)]:
                with self.assertRaises(ValueError):
                    media.open_media({'root': str(root), 'path': path})
            try:
                (root / 'escape.png').symlink_to(outside)
            except OSError:
                pass
            else:
                with self.assertRaises(ValueError):
                    media.open_media({'root': str(root), 'path': 'escape.png'})
            image.write_bytes(b'<html><script>not an image</script></html>')
            with self.assertRaisesRegex(ValueError, 'media_unsupported'):
                media.open_media({'root': str(root), 'path': 'render.png'})

    def test_file_size_limit_and_audio_video_signatures(self):
        self.assertEqual(media.media_type(b'RIFF\0\0\0\0WAVE', '.wav'), 'audio/wav')
        self.assertEqual(media.media_type(b'\0\0\0\x20ftypisom', '.mp4'), 'video/mp4')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'large.mp4'
            with path.open('wb') as f: f.truncate(media.LIMIT + 1)
            with self.assertRaisesRegex(ValueError, 'media_too_large'):
                media.open_media({'root': tmp, 'path': str(path)})


if __name__ == '__main__': unittest.main()
