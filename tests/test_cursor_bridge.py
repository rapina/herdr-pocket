import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'bridge'))
from cursor_bridge import apply_event, matching_binding, install, EVENTS
from session_reader import read_conversation


class CursorTest(unittest.TestCase):
    def test_binding_requires_live_process_and_terminal_generation(self):
        terminal = dict(address='host/t1', pid=10, created_ms=100, state='live')
        binding = dict(agentPid=12, agentStarted='start', terminalPid=10, terminalCreated=100)
        table = {12: dict(parent=11, cursor=True, started='start'), 11: dict(parent=10)}
        self.assertEqual(matching_binding(terminal, {'t1': binding}, table), binding)
        for changed in [dict(created_ms=101), dict(pid=20), dict(state='finished')]:
            self.assertIsNone(matching_binding({**terminal, **changed}, {'t1': binding}, table))
        for changed in [dict(started='new'), dict(parent=20), dict(cursor=False)]:
            self.assertIsNone(matching_binding(terminal, {'t1': binding}, {**table, 12: {**table[12], **changed}}))
        self.assertIsNone(matching_binding(terminal, {'t1': {**binding, 'ended': True}}, table))

    def test_delayed_start_does_not_clear_working_state(self):
        identity = dict(sessionId='chat', agentPid=12, agentStarted='start')
        value = apply_event({}, dict(hook_event_name='beforeSubmitPrompt', prompt='hello', generation_id='one'), identity, 't1')
        value = apply_event(value, dict(hook_event_name='sessionStart'), identity, 't2')
        self.assertEqual((value['state'], value['prompt'], value['generation']), ('working', 'hello', 'one'))
        stale = apply_event(value, dict(hook_event_name='stop', generation_id='old', status='completed'), identity, 't3')
        self.assertEqual(stale['state'], 'working')
        value = apply_event(value, dict(hook_event_name='stop', status='completed'), identity, 't3')
        value = apply_event(value, dict(hook_event_name='afterAgentResponse', text='answer'), identity, 't4')
        self.assertEqual((value['state'], value['reply']), ('done', 'answer'))

    def test_install_preserves_other_hooks_and_is_idempotent(self):
        with tempfile.TemporaryDirectory() as folder:
            home = pathlib.Path(folder)
            config = home / '.cursor/hooks.json'
            config.parent.mkdir()
            other = {'command': 'existing-hook', 'timeout': 10}
            config.write_text(json.dumps({'version': 1, 'hooks': {'stop': [other]}}), encoding='utf-8')
            install('source', home)
            install('source', home)
            hooks = json.loads(config.read_text())['hooks']
            self.assertEqual(hooks['stop'][0], other)
            self.assertEqual(len(hooks['stop']), 2)
            self.assertEqual(set(hooks), set(EVENTS))
            self.assertNotIn('afterAgentThought', hooks)
            self.assertTrue((home / '.cursor/herdr-pocket/hooks.before-pocket.json').exists())

    def test_transcript_hides_wrappers_tools_and_reasoning_and_paginates(self):
        def event(role, text, **extra):
            return {'role': role, 'message': {'content': [{'type': 'text', 'text': text}], **extra}}
        rows = [event('user', '<timestamp>private</timestamp><user_query>hello</user_query>'),
                event('assistant', 'private', channel='analysis'), event('tool', 'debug'),
                event('assistant', 'answer'), event('user', '# AGENTS.md instructions'),
                {'role': 'assistant', 'message': {'content': [{'type': 'thinking', 'text': 'secret'}]}}]
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'chat.jsonl'
            path.write_text('\n'.join(map(json.dumps, rows)), encoding='utf-8')
            messages = read_conversation(path, 'cursor')['messages']
            self.assertEqual([m['text'] for m in messages], ['hello', 'answer'])
            self.assertEqual(messages[1]['id'], 'cursor-3')
            self.assertEqual([m['text'] for m in read_conversation(path, 'cursor', 3)['messages']], ['hello'])


if __name__ == '__main__': unittest.main()
