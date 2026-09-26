import json
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from .execution import ExecutionService
from .history import save
from .provider import ModelProvider


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event), flush=True)


def wait_approval() -> bool:
    line = sys.stdin.readline()
    if not line:
        raise RuntimeError('Approval channel closed')
    return json.loads(line).get('approved') is True


def run(task: str, test_command: str, root: Path, provider: ModelProvider,
        send: Callable[[dict[str, Any]], None] = emit,
        approval: Callable[[], bool] = wait_approval) -> str:
    started = time.monotonic()
    record: dict[str, Any] = {
        'task_id': str(uuid.uuid4()), 'task_description': task,
        'agents_used': ['Orchestrator', 'Coder', 'Tester', 'Reviewer', 'Judge'] if test_command else ['Orchestrator', 'Coder', 'Reviewer', 'Judge'],
        'models': {}, 'model_calls': 0, 'input_tokens': None, 'output_tokens': None,
        'runtime_seconds': None, 'estimated_cost': None, 'files_changed': [],
        'tests_passed': None, 'tests_total': None, 'test_exit_code': None, 'test_output': None,
        'hidden_test_results': None,
        'bugs_detected': None, 'security_findings': None, 'disagreements': 0,
        'revisions': 0, 'final_outcome': 'incomplete',
        'started_at': datetime.now(timezone.utc).isoformat()
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
    def call(role: str, prompt: str) -> str:
        response = provider.complete(role, prompt)
        record['model_calls'] += 1
        record['models'][role] = response.model
        for key, value in [('input_tokens', response.input_tokens), ('output_tokens', response.output_tokens)]:
            if value is not None:
                record[key] = (record[key] or 0) + value
        return response.text

    try:
        event('Orchestrator', 'planning', 'Selected Coder, Reviewer, and Tester when a test command is supplied.',
              evidence={'task_id': record['task_id'], 'test_command': test_command or None})
        feedback = ''
        for attempt in range(3):
            event('Coder', 'working', 'Preparing a one-file candidate.' if not feedback else f'Revising after: {feedback}', kind='claim')
            prompt = task if not feedback else f'{task}\n\nPrevious review/test feedback: {feedback}'
            candidate = json.loads(call('coder', prompt))
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
            review = json.loads(call('reviewer', review_prompt))
            approved = review.get('approved') is True and tests_ok
            reason = str(review.get('reason', 'No reason supplied'))
            event('Reviewer', 'approved' if approved else 'rejected', reason,
                  kind='evidence' if approved else 'counterargument', debate=not approved,
                  evidence={'file_matches_proposal': actual == content, 'test_exit_code': code if test_command else None})
            if approved:
                record['final_outcome'] = 'verified' if test_command else 'reviewed_without_tests'
                event('Judge', 'complete', 'Verification passed.' if test_command else 'Review passed; test evidence unavailable.',
                      kind='decision', evidence={'reviewer_approved': True, 'tests_ok': tests_ok if test_command else None})
                break
            record['disagreements'] += 1
            record['revisions'] += 1
            feedback = f'{reason}\nTest output: {output}'
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
