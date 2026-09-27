"""Which model sits in which seat: coder, critics, judge, and the optional planning panel."""
import json
from dataclasses import dataclass, field

from .provider import MockProvider, ModelProvider, OpenAICompatibleProvider


@dataclass
class Seat:
    name: str
    provider: ModelProvider


@dataclass
class Team:
    coder: Seat
    critics: list[Seat]
    judge: Seat | None = None
    panel: list[Seat] = field(default_factory=list)
    panel_rounds: int = 2
    debate: bool = False

    @classmethod
    def solo(cls, provider: ModelProvider) -> 'Team':
        return cls(Seat('Coder', provider), [Seat('Reviewer', provider)])


def _seat(entry: dict) -> Seat:
    if entry.get('provider') == 'mock':
        return Seat(entry.get('name') or 'Mock', MockProvider())
    for key in ('url', 'key', 'model'):
        if not entry.get(key):
            raise ValueError(f'Model "{entry.get("name")}" is missing its {key}')
    return Seat(entry.get('name') or entry['model'], OpenAICompatibleProvider(entry['url'], entry['key'], entry['model']))


def team_from_json(raw: str) -> Team:
    data = json.loads(raw)
    critics = [_seat(entry) for entry in data.get('critics', [])]
    if not critics:
        raise ValueError('A debate needs at least one critic')
    panel = [_seat(entry) for entry in data.get('panel', [])]
    if panel and len(panel) < 2:
        raise ValueError('A planning panel needs at least two models')
    return Team(
        coder=_seat(data['coder']), critics=critics,
        judge=_seat(data['judge']) if data.get('judge') else None,
        panel=panel, panel_rounds=max(1, min(3, int(data.get('panelRounds', 2)))),
        debate=bool(data.get('debate')),
    )
