import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).parents[1] / 'bridge'))
from session_reader import choose_codex, choose_claude, read_conversation, conversation_metadata, recent_records


class SessionsTest(unittest.TestCase):
    def metadata(self, events, agent='codex'):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'session.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in events), encoding='utf-8')
            return conversation_metadata(path, agent)

    def test_response_time_ignores_newer_user_tools_and_reasoning(self):
        events = [dict(self.message('assistant', 'answer'), timestamp='2026-01-01T10:00:00Z'), {'type': 'event_msg', 'timestamp': '2026-01-01T11:00:00Z', 'payload': {'type': 'task_started'}}, dict(self.message('user', 'next'), timestamp='2026-01-01T11:00:01Z'), dict(self.message('assistant', 'private', phase='analysis'), timestamp='2026-01-01T11:00:02Z')]
        self.assertEqual(self.metadata(events), {'lastResponseAt': '2026-01-01T10:00:00Z', 'lastResponseText': 'answer', 'turnStartedAt': '2026-01-01T11:00:00Z'})

    def test_claude_turn_time_ignores_tool_result_user_records(self):
        events = [{'type': 'user', 'timestamp': '2026-01-01T10:00:00Z', 'message': {'content': 'question'}}, {'type': 'assistant', 'timestamp': '2026-01-01T10:00:10Z', 'message': {'content': [{'type': 'text', 'text': 'answer'}]}}, {'type': 'user', 'timestamp': '2026-01-01T10:00:20Z', 'message': {'content': [{'type': 'tool_result', 'content': 'debug'}]}}]
        self.assertEqual(self.metadata(events, 'claude-code'), {'lastResponseAt': '2026-01-01T10:00:10Z', 'lastResponseText': 'answer', 'turnStartedAt': '2026-01-01T10:00:00Z'})

    def test_notification_preview_uses_latest_visible_answer_and_is_bounded(self):
        answer = '한글😀' * 1000
        events = [dict(self.message('assistant', 'old'), timestamp='2026-01-01T10:00:00Z'),
                  {'type': 'event_msg', 'timestamp': '2026-01-01T10:01:00Z', 'payload': {'type': 'agent_message', 'message': answer}},
                  dict(self.message('assistant', 'hidden', channel='analysis'), timestamp='2026-01-01T10:02:00Z')]
        result = self.metadata(events)
        self.assertEqual(result['lastResponseText'], answer[:2000])
        self.assertEqual(result['lastResponseAt'], '2026-01-01T10:01:00Z')
        self.assertEqual(self.metadata([])['lastResponseText'], '')

    def test_reverse_reader_preserves_large_unicode_records_and_partial_tail(self):
        events = [{'text': '한글' * 40000}, {'text': 'last'}]
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'session.jsonl'
            path.write_text('\n'.join(json.dumps(e, ensure_ascii=False) for e in events) + '\n{"partial":', encoding='utf-8')
            self.assertEqual(list(recent_records(path)), list(reversed(events)))

    def conversation(self, events, agent='codex', before=None):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'session.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in events), encoding='utf-8')
            return read_conversation(path, agent, before)

    def message(self, role, text, **extra):
        return {'type': 'response_item', 'payload': {'type': 'message', 'role': role, 'content': [{'type': 'input_text' if role == 'user' else 'output_text', 'text': text}], **extra}}

    def test_current_title_overrides_old_launch_folder(self):
        sessions = [{'id': 'atlas', 'names': {'Windows에서 재현 확인'}, 'cwd': 'D:\\work\\atlas-core'}, {'id': 'orbit', 'names': {'패키지 업로드'}, 'cwd': 'D:\\work\\orbit-api'}]
        terminal = {'title': '⠧ Windows에서 재현 확인 | atlas-core', 'cwd': 'D:\\work\\orbit-api', 'labels': {'quad.agent': 'codex', 'quad.session': 'orbit'}}
        self.assertEqual(choose_codex(terminal, sessions)['id'], 'atlas')

    def test_ambiguous_titles_and_folder_only_matches_do_not_choose_a_session(self):
        session = {'id': 'one', 'names': {'same'}, 'cwd': 'D:\\work\\orbit-api'}
        self.assertIsNone(choose_codex({'title': 'same | orbit-api'}, [session, {**session, 'id': 'two'}]))
        self.assertIsNone(choose_codex({'title': '', 'cwd': session['cwd']}, [session]))

    def test_action_required_title_preserves_session_identity(self):
        session = {'id': 'one', 'names': {'Question | discussion'}, 'cwd': 'D:\\work\\atlas'}
        terminal = {'title': '[ ! ] Action Required | Question | discussion | atlas'}
        self.assertEqual(choose_codex(terminal, [session]), session)
        self.assertIsNone(choose_codex(terminal, [session, {**session, 'id': 'two'}]))

    def test_reused_terminal_does_not_trust_stale_quad_labels(self):
        old = {'id': 'old', 'names': {'Package upload'}, 'cwd': 'D:\\work\\orbit'}
        labels = {'quad.agent': 'codex', 'quad.session': 'old', 'quad.cwd': old['cwd']}
        for title in ['atlas', '', 'Package upload | atlas']:
            self.assertIsNone(choose_codex({'title': title, 'cwd': 'C:\\work\\atlas', 'labels': labels}, [old]))
        self.assertEqual(choose_codex({'title': 'Package upload | orbit', 'labels': labels}, [old]), old)

    def test_chat_keeps_only_visible_user_and_assistant_messages(self):
        events = [self.message('user', '# AGENTS.md instructions\nprivate context'), self.message('developer', 'internal'), self.message('user', '한글 질문', internal_chat_message_metadata_passthrough={'content_item_kinds': ['user.text']}), {'type': 'response_item', 'payload': {'type': 'custom_tool_call_output', 'output': 'debug output'}}, self.message('assistant', 'internal reasoning', phase='analysis'), self.message('assistant', '진행 설명', phase='commentary', id='progress'), self.message('assistant', '답변', phase='final_answer', id='answer'), self.message('assistant', '답변', phase='final_answer', id='answer')]
        messages = self.conversation(events)['messages']
        self.assertEqual([(m['role'], m['text']) for m in messages], [('user', '한글 질문'), ('assistant', '진행 설명'), ('assistant', '답변')])

    def test_history_pagination_does_not_duplicate_or_omit_messages(self):
        events = [self.message('user', str(i), id=str(i)) for i in range(100)]
        latest = self.conversation(events)
        earlier = self.conversation(events, before=latest['before'])
        self.assertTrue(latest['hasMore'])
        self.assertFalse(earlier['hasMore'])
        self.assertEqual([m['text'] for m in earlier['messages'] + latest['messages']], [str(i) for i in range(100)])

    def test_claude_ignores_tools_thinking_and_background_agent_messages(self):
        events = [{'type': 'user', 'uuid': 'u', 'message': {'role': 'user', 'content': '질문'}}, {'type': 'user', 'message': {'role': 'user', 'content': [{'type': 'tool_result', 'content': 'debug'}]}}, {'type': 'assistant', 'uuid': 'a', 'message': {'role': 'assistant', 'content': [{'type': 'thinking', 'thinking': 'private'}, {'type': 'text', 'text': '답변'}, {'type': 'tool_use', 'input': {}}]}}, {'type': 'assistant', 'isSidechain': True, 'message': {'content': 'other agent'}}]
        self.assertEqual([m['text'] for m in self.conversation(events, 'claude-code')['messages']], ['질문', '답변'])

    def test_claude_process_ancestry_selects_own_session(self):
        sessions = [{'pid': 11, 'sessionId': 'root'}, {'pid': 12, 'sessionId': 'nested'}, {'pid': 99, 'sessionId': 'unrelated'}]
        self.assertEqual(choose_claude({'pid': 10}, sessions, {11: 10, 12: 11})['sessionId'], 'root')

    def test_codex_live_message_event_is_visible_once(self):
        item = {'type': 'AgentMessage', 'id': 'progress', 'phase': 'commentary', 'content': [{'type': 'text', 'text': '파일을 확인하고 있습니다.'}]}
        events = [self.message('user', '확인해줘'), {'type': 'event_msg', 'payload': {'type': 'item_completed', 'item': item}}, self.message('assistant', '파일을 확인하고 있습니다.', id='progress', phase='commentary')]
        self.assertEqual([m['text'] for m in self.conversation(events)['messages']], ['확인해줘', '파일을 확인하고 있습니다.'])

    def test_activity_tracks_tools_without_returning_commands_or_reasoning(self):
        call = {'type': 'response_item', 'timestamp': '2026-01-01T00:00:00Z', 'payload': {'type': 'function_call', 'name': 'exec_command', 'call_id': 'tool1', 'arguments': 'private command'}}
        events = [self.message('user', '확인'), call, {'type': 'response_item', 'payload': {'type': 'reasoning', 'text': 'private reasoning'}}]
        live = self.conversation(events)
        self.assertEqual(live['activity']['label'], 'activity_command')
        self.assertEqual(live['activity']['state'], 'running')
        self.assertNotIn('private', json.dumps(live))
        events.append({'type': 'response_item', 'payload': {'type': 'function_call_output', 'call_id': 'tool1', 'output': 'private output'}})
        self.assertEqual(self.conversation(events)['activity']['state'], 'completed')
        events.append(self.message('assistant', '끝', phase='final_answer'))
        self.assertIsNone(self.conversation(events)['activity'])

    def test_claude_tools_expose_activity_not_debug_output(self):
        events = [{'type': 'assistant', 'message': {'content': [{'type': 'tool_use', 'id': 't', 'name': 'Edit', 'input': {'path': 'private'}}]}}]
        live = self.conversation(events, 'claude-code')
        self.assertEqual(live['messages'], [])
        self.assertEqual(live['activity']['label'], 'activity_edit')
        events.append({'type': 'user', 'message': {'content': [{'type': 'tool_result', 'tool_use_id': 't', 'content': 'private debug'}]}})
        self.assertEqual(self.conversation(events, 'claude-code')['activity']['state'], 'completed')


if __name__ == '__main__':
    unittest.main()
