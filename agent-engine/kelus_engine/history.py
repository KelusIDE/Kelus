import csv
import json
import os
import sqlite3
from pathlib import Path
from typing import Any


def database_path() -> Path:
    base = Path(os.environ.get('KELUS_DATA_DIR', Path.home() / '.kelus'))
    base.mkdir(parents=True, exist_ok=True)
    return base / 'runs.db'


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(database_path())
    db.execute('''CREATE TABLE IF NOT EXISTS runs (
        task_id TEXT PRIMARY KEY, task_description TEXT, agents_used TEXT, models TEXT,
        model_calls INTEGER, input_tokens INTEGER, output_tokens INTEGER,
        runtime_seconds REAL, estimated_cost REAL, files_changed TEXT,
        tests_passed INTEGER, tests_total INTEGER, test_exit_code INTEGER, test_output TEXT,
        hidden_test_results TEXT,
        bugs_detected INTEGER, security_findings INTEGER, disagreements INTEGER,
        revisions INTEGER, final_outcome TEXT, started_at TEXT
    )''')
    db.commit()
    columns = {row[1] for row in db.execute('PRAGMA table_info(runs)')}
    if 'test_exit_code' not in columns:
        db.execute('ALTER TABLE runs ADD COLUMN test_exit_code INTEGER')
        db.commit()
    if 'hidden_test_results' not in columns:
        db.execute('ALTER TABLE runs ADD COLUMN hidden_test_results TEXT')
        db.commit()
    if 'rag_sources' not in columns:
        db.execute('ALTER TABLE runs ADD COLUMN rag_sources TEXT')
        db.commit()
    return db


def save(record: dict[str, Any]) -> None:
    with connect() as db:
        fields = list(record)
        db.execute(f'INSERT OR REPLACE INTO runs ({",".join(fields)}) VALUES ({",".join("?" for _ in fields)})',
                   [json.dumps(record[key]) if isinstance(record[key], (list, dict)) else record[key] for key in fields])


def export(format: str, destination: Path) -> None:
    with connect() as db:
        db.row_factory = sqlite3.Row
        rows = [dict(row) for row in db.execute('SELECT * FROM runs ORDER BY started_at')]
    if format == 'json':
        for row in rows:
            for key in ('agents_used', 'models', 'files_changed', 'rag_sources'):
                row[key] = json.loads(row[key]) if row[key] else None
        destination.write_text(json.dumps(rows, indent=2), encoding='utf-8')
    elif format == 'csv':
        with destination.open('w', newline='', encoding='utf-8') as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]) if rows else ['task_id'])
            writer.writeheader()
            writer.writerows(rows)
    else:
        raise ValueError('Export format must be json or csv')
