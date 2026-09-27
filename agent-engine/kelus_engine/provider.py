import json
import os
import re
import urllib.request
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class ModelResponse:
    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class ModelProvider(Protocol):
    def complete(self, role: str, prompt: str) -> ModelResponse: ...


def parse_json(text: str) -> dict[str, Any]:
    """Parse a model's JSON reply, tolerating code fences or prose around the object."""
    cleaned = text.strip()
    fence = re.search(r'```(?:json)?\s*(.*?)```', cleaned, re.S)
    if fence:
        cleaned = fence.group(1).strip()
    try:
        value = json.loads(cleaned)
    except ValueError:
        start, end = cleaned.find('{'), cleaned.rfind('}')
        if start < 0 or end <= start:
            raise ValueError(f'Model did not return JSON: {text[:200]}')
        value = json.loads(cleaned[start:end + 1])
    if not isinstance(value, dict):
        raise ValueError('Model returned JSON that is not an object')
    return value


class MockProvider:
    """Deterministic provider for explicit file-and-content tasks only."""

    def complete(self, role: str, prompt: str) -> ModelResponse:
        if role == 'coder':
            match = re.search(r'(?:create|replace)\s+file\s+[`\"]?([^`\"\s:]+)[`\"]?\s*(?:with|containing|:)?\s*```[^\n]*\n(.*?)\n```', prompt, re.I | re.S)
            if not match:
                return ModelResponse(json.dumps({'error': 'Mock provider needs: Create file path with a fenced code block.'}), 'mock')
            return ModelResponse(json.dumps({'path': match.group(1), 'content': match.group(2) + '\n'}), 'mock')
        if role == 'reviewer':
            data = json.loads(prompt)
            ok = data['actual'] == data['proposed'] and data['tests_ok']
            return ModelResponse(json.dumps({
                'approved': ok, 'reason': 'File matches the proposal and checks passed.' if ok else 'File differs or checks failed.'
            }), 'mock')
        if role == 'rebuttal':
            data = json.loads(prompt)
            return ModelResponse(json.dumps({
                'response': 'Conceding: ' + '; '.join(o['reason'] for o in data['objections']) if data['objections'] else 'No objections to answer.',
                'concede': True
            }), 'mock')
        if role == 'judge':
            data = json.loads(prompt)
            accept = data['tests_ok'] and all(c['approved'] for c in data['critiques'])
            return ModelResponse(json.dumps({
                'decision': 'accept' if accept else 'revise',
                'reason': 'Tests pass and every critic approved.' if accept else 'Tests failed or a critic objection stands.'
            }), 'mock')
        if role == 'panelist':
            data = json.loads(prompt)
            return ModelResponse(json.dumps({
                'message': f'Round {data["round"]}: implement exactly what the task describes.',
                'plan': 'Write the requested file with the given content.'
            }), 'mock')
        if role == 'vote':
            return ModelResponse(json.dumps({'vote': 1, 'reason': 'It covers the task directly.'}), 'mock')
        raise ValueError(f'Unknown role: {role}')


SYSTEM_PROMPTS = {
    'coder': (
        'You are the Kelus coder. Return only JSON: {"path":"relative/path", "content":"complete file content"}. '
        'Only edit one file, stay within the project, and do not propose deletion. '
        'If the prompt includes an agreed plan from the Kelus panel, follow it.'
    ),
    'reviewer': (
        'You are an independent, skeptical code critic. Inspect the user goal, proposal, actual file and test output. '
        'Look for bugs, unmet requirements and security problems; do not approve just to agree. '
        'Return only JSON: {"approved": boolean, "reason":"specific evidence"}.'
    ),
    'rebuttal': (
        'You are the Kelus coder answering critics who objected to your change. Address each objection with evidence: '
        'concede when the critic is right, push back when they are wrong. '
        'Return only JSON: {"response":"your answer to each objection", "concede": boolean}.'
    ),
    'judge': (
        'You are the Kelus judge. Weigh the critics, the coder rebuttal and the test evidence. '
        'Failing tests always mean revise. Accept only when the change meets the task. '
        'Return only JSON: {"decision":"accept" or "revise", "reason":"cite the decisive evidence"}.'
    ),
    'panelist': (
        'You are one expert on the Kelus planning panel, discussing how to implement a task before any code is written. '
        'Reply to other panelists by name, agree or push back with reasons, and keep it under 120 words. '
        'Return only JSON: {"message":"your contribution to the discussion", "plan":"your current concrete plan in 1-4 steps"}.'
    ),
    'vote': (
        'You are voting for the best implementation plan from the Kelus panel. Judge the plans on merit, not authorship. '
        'Return only JSON: {"vote": plan number, "reason":"why"}.'
    ),
}
TEMPERATURES = {'panelist': 0.5}


class OpenAICompatibleProvider:
    """Provider using an OpenAI-compatible chat completions endpoint."""

    def __init__(self, url: str | None = None, key: str | None = None, model: str | None = None) -> None:
        self.url = url or os.environ['KELUS_MODEL_URL']
        self.key = key or os.environ['KELUS_MODEL_API_KEY']
        self.model = model or os.environ['KELUS_MODEL_NAME']

    def complete(self, role: str, prompt: str) -> ModelResponse:
        payload = json.dumps({'model': self.model, 'messages': [
            {'role': 'system', 'content': SYSTEM_PROMPTS[role]}, {'role': 'user', 'content': prompt}
        ], 'temperature': TEMPERATURES.get(role, 0)}).encode()
        request = urllib.request.Request(self.url, payload, {
            'Content-Type': 'application/json', 'Authorization': f'Bearer {self.key}'
        })
        with urllib.request.urlopen(request, timeout=120) as response:
            data = json.load(response)
        usage = data.get('usage', {})
        return ModelResponse(data['choices'][0]['message']['content'], self.model,
                             usage.get('prompt_tokens'), usage.get('completion_tokens'))


def configured_provider() -> ModelProvider:
    values = [os.getenv(key) for key in ('KELUS_MODEL_URL', 'KELUS_MODEL_API_KEY', 'KELUS_MODEL_NAME')]
    if all(values):
        return OpenAICompatibleProvider()
    if any(values):
        raise ValueError('Set all three KELUS_MODEL_URL, KELUS_MODEL_API_KEY and KELUS_MODEL_NAME variables')
    return MockProvider()
