import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .execution import ExecutionService
from .history import save
from .provider import ModelProvider, parse_json
from .retrieval import build_index, context_block, search
from .team import Seat, Team


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event), flush=True)


def wait_approval() -> bool:
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError('Approval channel closed')
    return json.loads(line).get('approved') is True


def run_panel(team: Team, task: str, rag_context: str, call: Callable[..., str],
              event: Callable[..., None], seat_tag: Callable[[Seat], dict[str, Any]], record: dict[str, Any]) -> str:
    """Free-form planning debate: panelists discuss in rounds, then vote on a plan for the coder."""
    record['agents_used'].insert(1, 'Panel')
    transcript: list[dict[str, str]] = []
    for round_number in range(1, team.panel_rounds + 1):
        for seat in team.panel:
            reply = parse_json(call(seat, 'panelist', json.dumps({
                'task': task, 'you_are': seat.name, 'round': round_number, 'rounds': team.panel_rounds,
                'project_context': rag_context[:6000], 'discussion_so_far': transcript})))
            message, plan = str(reply.get('message', '')).strip(), str(reply.get('plan', '')).strip()
            transcript.append({'speaker': seat.name, 'message': message, 'plan': plan})
            event('Panel', 'discussing', message or '(no comment)', kind='claim' if round_number == 1 else 'counterargument',
                  debate=round_number > 1, **seat_tag(seat), **({'evidence': {'plan': plan}} if plan else {}))
    latest: dict[str, dict[str, str]] = {}
    for entry in transcript:
        if entry['plan']:
            latest[entry['speaker']] = entry
    plans = list(latest.values())
    if not plans:
        event('Judge', 'no-plan', 'The panel did not propose a plan; the coder works from the task alone.', kind='decision')
        return ''
    votes = [0] * len(plans)
    ballot = [{'number': i + 1, 'author': p['speaker'], 'plan': p['plan']} for i, p in enumerate(plans)]
    for seat in team.panel:
        choice = parse_json(call(seat, 'vote', json.dumps({'task': task, 'you_are': seat.name, 'plans': ballot})))
        try:
            index = min(max(int(choice.get('vote', 1)) - 1, 0), len(plans) - 1)
        except (TypeError, ValueError):
            index = 0
        votes[index] += 1
        event('Panel', 'voted', f'Plan {index + 1} ({plans[index]["speaker"]}): {choice.get("reason", "")}', kind='evidence', **seat_tag(seat))
    winner = votes.index(max(votes))
    event('Judge', 'decided', f'Panel chose plan {winner + 1} by {plans[winner]["speaker"]} with {votes[winner]} of {len(team.panel)} votes.',
          kind='decision', evidence={'plan': plans[winner]['plan'], 'votes': votes})
    return plans[winner]['plan']


def run(task: str, test_command: str, root: Path, provider: ModelProvider | Team,
        send: Callable[[dict[str, Any]], None] = emit,
        approval: Callable[[], bool] = wait_approval) -> str:
    started = time.monotonic()
    team = provider if isinstance(provider, Team) else Team.solo(provider)
    record: dict[str, Any] = {
        'task_id': str(uuid.uuid4()), 'task_description': task,
        'agents_used': ['Orchestrator', 'Coder', 'Tester', 'Reviewer', 'Judge'] if test_command else ['Orchestrator', 'Coder', 'Reviewer', 'Judge'],
        'models': {}, 'usage': {}, 'model_calls': 0, 'input_tokens': None, 'output_tokens': None,
        'runtime_seconds': None, 'estimated_cost': None, 'files_changed': [],
        'tests_passed': None, 'tests_total': None, 'test_exit_code': None, 'test_output': None,
        'hidden_test_results': None,
        'bugs_detected': None, 'security_findings': None, 'disagreements': 0,
        'revisions': 0, 'final_outcome': 'incomplete',
        'started_at': datetime.now(timezone.utc).isoformat(), 'rag_sources': []
    }
    service = ExecutionService(root)
    originals: dict[str, str | None] = {}
    def event(agent: str, status: str, message: str, *, kind: str | None = None, debate: bool = False, **extra: Any) -> None:
        # `kind` places this event on the evidence-based arbitration path (see docs/architecture.md):
        # claim (Coder) -> evidence (Tester) -> counterargument (Reviewer, when it disagrees) -> decision (Judge).
        payload: dict[str, Any] = {'type': 'agent', 'agent': agent, 'status': status, 'message': message, **extra}
        if kind:
            payload['kind'] = kind
        if debate:
            payload['debate'] = True
        send(payload)
    def call(seat: Seat, role: str, prompt: str) -> str:
        response = seat.provider.complete(role, prompt)
        record['model_calls'] += 1
        record['models'][role if not team.debate and not team.panel else f'{role}:{seat.name}'] = response.model
        for key, value in [('input_tokens', response.input_tokens), ('output_tokens', response.output_tokens)]:
            if value is not None:
                record[key] = (record[key] or 0) + value
        usage = record['usage'].setdefault(response.model, {'calls': 0, 'input_tokens': 0, 'output_tokens': 0})
        usage['calls'] += 1
        usage['input_tokens'] += response.input_tokens or 0
        usage['output_tokens'] += response.output_tokens or 0
        return response.text
    def seat_tag(seat: Seat) -> dict[str, Any]:
        return {'model': seat.name} if team.debate or team.panel else {}

    try:
        if team.debate:
            record['agents_used'] = ['Orchestrator', 'Coder', *(['Tester'] if test_command else []),
                                     *[f'Critic {i + 1}' for i in range(len(team.critics))], 'Judge']
            lineup = ', '.join([f'Coder: {team.coder.name}', *[f'Critic {i + 1}: {c.name}' for i, c in enumerate(team.critics)],
                                f'Judge: {team.judge.name if team.judge else "evidence rules"}'])
            event('Orchestrator', 'planning', f'Debate lineup — {lineup}.',
                  evidence={'task_id': record['task_id'], 'test_command': test_command or None})
        else:
            event('Orchestrator', 'planning', 'Selected Coder, Reviewer, and Tester when a test command is supplied.',
                  evidence={'task_id': record['task_id'], 'test_command': test_command or None})
        rag_context = ''
        index = build_index(root)
        if index is not None:
            matches = search(index, task)
            index.close()
            record['agents_used'].insert(1, 'Retriever')
            record['rag_sources'] = [match.path for match in matches]
            rag_context = context_block(matches)
            event('Retriever', 'complete' if matches else 'empty',
                  f'Found {len(matches)} relevant file(s) for context.' if matches else 'No relevant existing files found.',
                  evidence={'files': record['rag_sources']})
        agreed_plan = run_panel(team, task, rag_context, call, event, seat_tag, record) if team.panel else ''
        feedback = ''
        for attempt in range(3):
            event('Coder', 'working', 'Preparing a one-file candidate.' if not feedback else f'Revising after: {feedback}',
                  kind='claim', **seat_tag(team.coder))
            prompt = task if not feedback else f'{task}\n\nPrevious review/test feedback: {feedback}'
            if agreed_plan:
                prompt = f'{prompt}\n\nAgreed plan from the Kelus panel:\n{agreed_plan}'
            if rag_context:
                prompt = f'{prompt}\n\n{rag_context}'
            candidate = parse_json(call(team.coder, 'coder', prompt))
            if 'error' in candidate:
                raise ValueError(candidate['error'])
            relative, content = candidate['path'], candidate['content']
            target = service.path(relative)
            before = target.read_text(encoding='utf-8') if target.exists() else None
            if relative not in originals:
                originals[relative] = before
            send({'type': 'approval', 'path': relative, 'before': before, 'after': content,
                  'test_command': test_command or None, 'message': 'Approve this file change and test command?'})
            if not approval():
                record['final_outcome'] = 'declined'
                event('Orchestrator', 'stopped', 'User declined the proposed action.')
                break
            service.write_approved(relative, content, True)
            if relative not in record['files_changed']:
                record['files_changed'].append(relative)
            event('Coder', 'done', f'Wrote {relative}.', kind='claim', evidence={'path': relative})
            code, output = (service.run_approved(test_command, True) if test_command else (0, 'No test command supplied.'))
            tests_ok = code == 0
            record['test_output'] = output
            if test_command:
                record['test_exit_code'] = code
            event('Tester', 'passed' if tests_ok and test_command else ('failed' if test_command else 'unavailable'),
                  f'Test command exited {code}.' if test_command else 'No test command supplied.', kind='evidence',
                  evidence={'command': test_command or None, 'exit_code': code if test_command else None, 'output': output})
            actual = service.read(relative)
            review_prompt = json.dumps({'task': task, 'path': relative, 'before': before,
                                        'proposed': content, 'actual': actual, 'tests_ok': tests_ok,
                                        'test_command': test_command, 'test_output': output})
            critiques = []
            for number, critic in enumerate(team.critics, start=1):
                review = parse_json(call(critic, 'reviewer', review_prompt))
                approved = review.get('approved') is True and tests_ok
                reason = str(review.get('reason', 'No reason supplied'))
                critiques.append({'critic': critic.name, 'approved': approved, 'reason': reason})
                event('Reviewer' if not team.debate else f'Critic {number}', 'approved' if approved else 'rejected', reason,
                      kind='evidence' if approved else 'counterargument', debate=not approved, **seat_tag(critic),
                      evidence={'file_matches_proposal': actual == content, 'test_exit_code': code if test_command else None})
            objections = [c for c in critiques if not c['approved']]
            accepted = not objections
            reason = '\n'.join(f'{c["critic"]}: {c["reason"]}' for c in objections)
            if objections and team.debate:
                rebuttal = parse_json(call(team.coder, 'rebuttal', json.dumps({
                    'task': task, 'path': relative, 'content': content, 'objections': objections,
                    'tests_ok': tests_ok, 'test_output': output})))
                answer = str(rebuttal.get('response', ''))
                event('Coder', 'conceded' if rebuttal.get('concede') else 'rebutted', answer, kind='claim', debate=True, **seat_tag(team.coder))
                if team.judge:
                    verdict = parse_json(call(team.judge, 'judge', json.dumps({
                        'task': task, 'path': relative, 'content': content, 'tests_ok': tests_ok,
                        'test_output': output, 'critiques': critiques, 'rebuttal': answer})))
                    reason = str(verdict.get('reason', reason))
                    # Tests are the hard evidence: a judge can overrule critics, never a failing test.
                    accepted = verdict.get('decision') == 'accept' and tests_ok
                    event('Judge', 'overruled' if accepted else 'revision', reason, kind='decision', **seat_tag(team.judge),
                          evidence={'objections': len(objections), 'tests_ok': tests_ok if test_command else None})
            if accepted:
                record['final_outcome'] = 'verified' if test_command else 'reviewed_without_tests'
                if not objections:
                    event('Judge', 'complete', 'Verification passed.' if test_command else 'Review passed; test evidence unavailable.',
                          kind='decision', evidence={'reviewer_approved': True, 'tests_ok': tests_ok if test_command else None})
                break
            record['disagreements'] += max(1, len(objections))
            record['revisions'] += 1
            feedback = f'{reason}\nTest output: {output}'
            if not (team.debate and team.judge and objections):
                event('Judge', 'revision', 'Requesting revision from Coder because the evidence supports the review finding.',
                      kind='decision', evidence={'reason': reason, 'tests_ok': tests_ok if test_command else None})
        else:
            record['final_outcome'] = 'failed_verification'
            event('Judge', 'failed', 'Revision limit reached without verification.', kind='decision')
    except Exception as error:
        record['final_outcome'] = 'error'
        send({'type': 'error', 'message': str(error)})
    finally:
        if record['final_outcome'] not in ('verified', 'reviewed_without_tests') and record['files_changed']:
            try:
                for relative, original in originals.items():
                    service.restore_after_failed_run(relative, original)
                event('Orchestrator', 'restored', 'Restored files after an unsuccessful run.')
                record['files_changed'] = []
            except Exception as restore_error:
                send({'type': 'error', 'message': f'Could not restore candidate files: {restore_error}'})
        record['runtime_seconds'] = round(time.monotonic() - started, 3)
        save(record)
        send({'type': 'summary', 'record': record})
    return record['final_outcome']
