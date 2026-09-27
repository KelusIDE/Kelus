import argparse
import json
import os
import sys
from pathlib import Path

from kelus_engine.history import export
from kelus_engine.provider import configured_provider
from kelus_engine.team import team_from_json
from kelus_engine.workflow import run


def main() -> None:
    parser = argparse.ArgumentParser(description='Kelus agent backend')
    parser.add_argument('--workspace', type=Path)
    parser.add_argument('--task')
    parser.add_argument('--test-command', default='')
    parser.add_argument('--export', choices=['json', 'csv'])
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if args.export:
        if not args.output:
            parser.error('--output is required for export')
        export(args.export, args.output)
        return
    if not args.workspace or not args.task:
        parser.error('--workspace and --task are required')
    team_config = os.environ.get('KELUS_TEAM')
    try:
        provider = team_from_json(team_config) if team_config else configured_provider()
    except (ValueError, KeyError) as error:
        print(json.dumps({'type': 'error', 'message': f'Agent team setup: {error}'}), flush=True)
        sys.exit(1)
    outcome = run(args.task, args.test_command, args.workspace, provider)
    if outcome not in ('verified', 'reviewed_without_tests', 'declined'):
        sys.exit(1)


if __name__ == '__main__':
    main()
