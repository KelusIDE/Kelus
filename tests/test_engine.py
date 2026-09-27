import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent-engine'))

from kelus_engine.execution import ExecutionService
from kelus_engine.history import connect, export
from kelus_engine.provider import MockProvider
from kelus_engine.workflow import run


class ExecutionTests(unittest.TestCase):
    def test_write_requires_approval_and_stays_in_workspace(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'project'
            root.mkdir()
            outside = Path(temporary) / 'outside.txt'
            outside.write_text('safe')
            (root / 'link.txt').symlink_to(outside)
            service = ExecutionService(root)
            with self.assertRaises(PermissionError):
                service.write_approved('file.txt', 'new', False)
            with self.assertRaises(ValueError):
                service.write_approved('../outside.txt', 'new', True)
            with self.assertRaises(ValueError):
                service.write_approved('link.txt', 'new', True)
            self.assertEqual(outside.read_text(), 'safe')

    def test_commands_require_approval_and_report_real_exit(self):
        with tempfile.TemporaryDirectory() as temporary:
            service = ExecutionService(Path(temporary))
            with self.assertRaises(PermissionError):
                service.run_approved('python3 -c "print(1)"', False)
            code, output = service.run_approved(f'{sys.executable} -c "print(42)"', True)
            self.assertEqual(code, 0)
            self.assertIn('42', output)
            code, _ = service.run_approved(f'{sys.executable} -c "exit(3)"', True)
            self.assertEqual(code, 3)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.root.mkdir()
        self.data = Path(self.temporary.name) / 'data'
        self.env = patch.dict(os.environ, {'KELUS_DATA_DIR': str(self.data)})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.task = 'Create file hello.py with\n```python\nprint("hello")\n```'

    def test_mock_provider_requires_explicit_content(self):
        result = MockProvider().complete('coder', 'Make a web app')
        self.assertIn('error', result.text)

    def test_approved_change_is_tested_reviewed_and_logged(self):
        events = []
        outcome = run(self.task, f'{sys.executable} hello.py', self.root, MockProvider(), events.append, lambda: True)
        self.assertEqual(outcome, 'verified')
        self.assertEqual((self.root / 'hello.py').read_text(), 'print("hello")\n')
        summary = events[-1]['record']
        self.assertIsNone(summary['tests_passed'])
        self.assertIsNone(summary['tests_total'])
        self.assertEqual(summary['test_exit_code'], 0)
        self.assertEqual(summary['model_calls'], 2)
        self.assertIsNone(summary['input_tokens'])
        with connect() as db:
            self.assertEqual(db.execute('SELECT final_outcome FROM runs').fetchone()[0], 'verified')
        destination = self.data / 'runs.json'
        export('json', destination)
        self.assertIn('hello.py', destination.read_text())

    def test_decline_does_not_write(self):
        events = []
        outcome = run(self.task, '', self.root, MockProvider(), events.append, lambda: False)
        self.assertEqual(outcome, 'declined')
        self.assertFalse((self.root / 'hello.py').exists())
        self.assertEqual(events[-1]['record']['tests_total'], None)

    def test_failed_test_never_claims_verification(self):
        events = []
        outcome = run(self.task, f'{sys.executable} -c "exit(2)"', self.root, MockProvider(), events.append, lambda: True)
        self.assertEqual(outcome, 'failed_verification')
        self.assertEqual(events[-1]['record']['test_exit_code'], 2)
        self.assertEqual(events[-1]['record']['revisions'], 3)
        self.assertFalse((self.root / 'hello.py').exists())

    def test_failed_replacement_restores_original_content(self):
        (self.root / 'hello.py').write_text('original\n')
        outcome = run(self.task.replace('Create file', 'Replace file'),
                      f'{sys.executable} -c "exit(2)"', self.root, MockProvider(),
                      lambda _event: None, lambda: True)
        self.assertEqual(outcome, 'failed_verification')
        self.assertEqual((self.root / 'hello.py').read_text(), 'original\n')


class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.root.mkdir()
        self.data = Path(self.temporary.name) / 'data'
        self.env = patch.dict(os.environ, {'KELUS_DATA_DIR': str(self.data)})
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_finds_and_surfaces_a_relevant_existing_file(self):
        (self.root / 'auth.py').write_text('# authentication helpers\ndef check():\n    return True\n')
        task = 'Create file hello.py with\n```python\nprint("about authentication flow")\n```'
        events = []
        outcome = run(task, '', self.root, MockProvider(), events.append, lambda: True)
        self.assertEqual(outcome, 'reviewed_without_tests')
        retriever_events = [event for event in events if event.get('agent') == 'Retriever']
        self.assertEqual(len(retriever_events), 1)
        self.assertEqual(retriever_events[0]['evidence']['files'], ['auth.py'])
        self.assertLess(events.index(retriever_events[0]),
                         events.index(next(event for event in events if event.get('agent') == 'Coder')))
        summary = events[-1]['record']
        self.assertIn('Retriever', summary['agents_used'])
        self.assertEqual(summary['rag_sources'], ['auth.py'])
        with connect() as db:
            self.assertEqual(db.execute('SELECT rag_sources FROM runs').fetchone()[0], '["auth.py"]')
        destination = self.data / 'runs.json'
        export('json', destination)
        self.assertIn('"auth.py"', destination.read_text())

    def test_empty_project_completes_without_matches(self):
        task = 'Create file hello.py with\n```python\nprint("hello")\n```'
        events = []
        outcome = run(task, '', self.root, MockProvider(), events.append, lambda: True)
        self.assertEqual(outcome, 'reviewed_without_tests')
        retriever_events = [event for event in events if event.get('agent') == 'Retriever']
        self.assertEqual(retriever_events[0]['status'], 'empty')
        self.assertEqual(events[-1]['record']['rag_sources'], [])


if __name__ == '__main__':
    unittest.main()
