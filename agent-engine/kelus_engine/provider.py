import json
import os
import re
import urllib.request
from dataclasses import dataclass
from typing import Protocol


@dataclass
class ModelResponse:
    text: str
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None


class ModelProvider(Protocol):
    def complete(self, role: str, prompt: str) -> ModelResponse: ...


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
            return ModelResponse(json.dumps({
                'approved': data['actual'] == data['proposed'] and data['tests_ok'],
                'reason': 'File matches the proposal and checks passed.' if data['actual'] == data['proposed'] and data['tests_ok'] else 'File differs or checks failed.'
            }), 'mock')
        raise ValueError(f'Unknown role: {role}')


class OpenAICompatibleProvider:
    """Optional provider using an OpenAI-compatible chat completions endpoint."""

    def __init__(self) -> None:
        self.url = os.environ['KELUS_MODEL_URL']
        self.key = os.environ['KELUS_MODEL_API_KEY']
        self.model = os.environ['KELUS_MODEL_NAME']

    def complete(self, role: str, prompt: str) -> ModelResponse:
        system = (
            'You are the Kelus coder. Return only JSON: {"path":"relative/path", "content":"complete file content"}. '
            'Only edit one file, stay within the project, and do not propose deletion.'
            if role == 'coder' else
            'You are an independent code reviewer. Inspect the user goal, proposal, actual file and test output. '
            'Return only JSON: {"approved": boolean, "reason":"specific evidence"}.'
        )
        payload = json.dumps({'model': self.model, 'messages': [
            {'role': 'system', 'content': system}, {'role': 'user', 'content': prompt}
        ], 'temperature': 0}).encode()
        request = urllib.request.Request(self.url, payload, {
            'Content-Type': 'application/json', 'Authorization': f'Bearer {self.key}'
        })
        with urllib.request.urlopen(request, timeout=90) as response:
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
