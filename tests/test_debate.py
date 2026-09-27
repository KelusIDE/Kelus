import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent-engine'))

from kelus_engine.provider import MockProvider, ModelResponse, parse_json  # noqa: E402
from kelus_engine.team import Seat, Team, team_from_json  # noqa: E402
from kelus_engine.workflow import run  # noqa: E402


class Scripted(MockProvider):
    """Mock that overrides chosen roles with fixed JSON replies and records every prompt."""

    def __init__(self, **replies):
        self.replies = replies
        self.prompts = []

    def complete(self, role, prompt):
        self.prompts.append((role, prompt))
        if role in self.replies:
            return ModelResponse('```json\n' + json.dumps(self.replies[role]) + '\n```', 'scripted')
        return super().complete(role, prompt)


class DebateTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'project'
        self.root.mkdir()
        self.env = patch.dict(os.environ, {'KELUS_DATA_DIR': str(Path(self.temporary.name) / 'data')})
        self.env.start()
        self.addCleanup(self.env.stop)
        self.task = 'Create file hello.py with\n```python\nprint("hello")\n```'

    def team(self, judge_decision, critic_approves=False):
        self.coder = Scripted()
        self.harsh = Scripted(reviewer={'approved': critic_approves, 'reason': 'Missing a docstring.'})
        self.judge = Scripted(judge={'decision': judge_decision, 'reason': 'The docstring objection is not in the task.'})
        return Team(coder=Seat('Coder model', self.coder),
                    critics=[Seat('Friendly', MockProvider()), Seat('Harsh', self.harsh)],
                    judge=Seat('Judge model', self.judge), debate=True)

    def test_judge_can_overrule_a_critic_when_tests_pass(self):
        events = []
        outcome = run(self.task, f'{sys.executable} hello.py', self.root, self.team('accept'), events.append, lambda: True)
        self.assertEqual(outcome, 'verified')
        agents = [(e.get('agent'), e.get('status'), e.get('model')) for e in events if e.get('type') == 'agent']
        self.assertIn(('Critic 1', 'approved', 'Friendly'), agents)
        self.assertIn(('Critic 2', 'rejected', 'Harsh'), agents)
        self.assertIn(('Coder', 'conceded', 'Coder model'), agents)
        self.assertIn(('Judge', 'overruled', 'Judge model'), agents)
        record = events[-1]['record']
        self.assertEqual(record['disagreements'], 0)
        self.assertIn('judge:Judge model', record['models'])

    def test_judge_cannot_accept_failing_tests(self):
        events = []
        outcome = run(self.task, f'{sys.executable} -c "exit(2)"', self.root, self.team('accept', critic_approves=True),
                      events.append, lambda: True)
        self.assertEqual(outcome, 'failed_verification')
        self.assertFalse((self.root / 'hello.py').exists())
        self.assertFalse(any(e.get('status') == 'overruled' for e in events))

    def test_judge_revision_feeds_objections_back_to_coder(self):
        events = []
        outcome = run(self.task, '', self.root, self.team('revise'), events.append, lambda: True)
        self.assertEqual(outcome, 'failed_verification')
        coder_prompts = [p for role, p in self.coder.prompts if role == 'coder']
        self.assertEqual(len(coder_prompts), 3)
        self.assertIn('docstring objection', coder_prompts[1])

    def test_panel_discusses_votes_and_hands_plan_to_coder(self):
        coder = Scripted()
        team = Team(coder=Seat('Coder model', coder), critics=[Seat('Critic', MockProvider())],
                    panel=[Seat('Alpha', MockProvider()), Seat('Beta', Scripted(vote={'vote': 2, 'reason': 'Beta plan'}))],
                    panel_rounds=2)
        events = []
        outcome = run(self.task, '', self.root, team, events.append, lambda: True)
        self.assertEqual(outcome, 'reviewed_without_tests')
        panel = [e for e in events if e.get('agent') == 'Panel']
        self.assertEqual([e['status'] for e in panel], ['discussing'] * 4 + ['voted'] * 2)
        self.assertEqual([e['model'] for e in panel[:4]], ['Alpha', 'Beta', 'Alpha', 'Beta'])
        decision = next(e for e in events if e.get('status') == 'decided')
        self.assertEqual(decision['evidence']['votes'], [1, 1])
        self.assertIn('Agreed plan from the Kelus panel', coder.prompts[0][1])
        self.assertIn('Panel', events[-1]['record']['agents_used'])

    def test_solo_mode_is_unchanged(self):
        events = []
        outcome = run(self.task, '', self.root, MockProvider(), events.append, lambda: True)
        self.assertEqual(outcome, 'reviewed_without_tests')
        self.assertFalse(any('model' in e for e in events if e.get('type') == 'agent'))
        self.assertEqual(set(events[-1]['record']['models']), {'coder', 'reviewer'})


class ConfigTests(unittest.TestCase):
    def test_parse_json_tolerates_fences_and_prose(self):
        self.assertEqual(parse_json('Sure!\n```json\n{"a": 1}\n```'), {'a': 1})
        self.assertEqual(parse_json('Here: {"a": 2} done'), {'a': 2})
        with self.assertRaises(ValueError):
            parse_json('no json here')

    def test_team_from_json_validates_seats(self):
        mock = {'name': 'Mock', 'provider': 'mock'}
        team = team_from_json(json.dumps({'coder': mock, 'critics': [mock, mock], 'judge': mock, 'debate': True, 'panelRounds': 9}))
        self.assertEqual((len(team.critics), team.panel_rounds, team.debate), (2, 3, True))
        with self.assertRaises(ValueError):
            team_from_json(json.dumps({'coder': mock, 'critics': []}))
        with self.assertRaises(ValueError):
            team_from_json(json.dumps({'coder': mock, 'critics': [mock], 'panel': [mock]}))
        with self.assertRaises(ValueError):
            team_from_json(json.dumps({'coder': {'name': 'X', 'provider': 'openai-compatible', 'url': 'https://x'}, 'critics': [mock]}))


if __name__ == '__main__':
    unittest.main()
