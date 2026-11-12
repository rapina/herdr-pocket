import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('media_reader', Path(__file__).parents[1] / 'bridge/media_reader.py')
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)

PNG = b'\x89PNG\r\n\x1a\n' + b'\0' * 64


class MediaReaderTests(unittest.TestCase):
    def test_paths_outside_the_workspace_are_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            parent = Path(tmp)
            root = parent / 'workspace'
            root.mkdir()
            scratch = parent / 'claude-501/-Users-me-projects-game/11111111-1111-1111-1111-111111111111/scratchpad'
            scratch.mkdir(parents=True)
            hidden = parent / '.cache'
            hidden.mkdir()
            for image in [scratch / 'cycle.png', parent / 'secret.png', hidden / 'shot.png']:
                image.write_bytes(PNG)
                stream, info = media.open_media({'root': str(root), 'path': str(image)})
                with stream: self.assertEqual(info['mime'], 'image/png')
            stream, info = media.open_media({'root': str(root), 'path': '../secret.png'})
            with stream: self.assertEqual(len(stream.read()), info['size'])
            with patch.object(media.Path, 'home', return_value=parent):
                stream, info = media.open_media({'root': str(root), 'path': '~/secret.png'})
                with stream: self.assertEqual(info['mime'], 'image/png')

    def test_missing_files_folders_and_network_shares_are_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for path in [str(root), str(root / 'missing.png'), 'a\x00.png']:
                with self.assertRaises((ValueError, OSError)):
                    media.open_media({'root': str(root), 'path': path})
            for path in [r'\\server\share\a.png', '//server/share/a.png', r'\\?\UNC\server\share\a.png']:
                with self.assertRaisesRegex(ValueError, 'media_forbidden'):
                    media.open_media({'root': str(root), 'path': path})
            self.assertFalse(media.is_network_path(r'\\?\C:\work\a.png'))

    def test_content_type_comes_from_the_file_signature(self):
        with tempfile.TemporaryDirectory() as tmp:
            image = Path(tmp) / 'render.png'
            image.write_bytes(b'<html><script>not an image</script></html>')
            with self.assertRaisesRegex(ValueError, 'media_unsupported'):
                media.open_media({'root': tmp, 'path': 'render.png'})

    def test_file_size_limit_and_audio_video_signatures(self):
        self.assertEqual(media.media_type(b'RIFF\0\0\0\0WAVE', '.wav'), 'audio/wav')
        self.assertEqual(media.media_type(b'\0\0\0\x20ftypisom', '.mp4'), 'video/mp4')
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'large.mp4'
            with path.open('wb') as f: f.truncate(media.LIMIT + 1)
            with self.assertRaisesRegex(ValueError, 'media_too_large'):
                media.open_media({'root': tmp, 'path': str(path)})


if __name__ == '__main__': unittest.main()
