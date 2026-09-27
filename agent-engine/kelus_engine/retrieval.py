# Lexical retrieval (RAG) over the open project's own files, via SQLite FTS5.
# Kept dependency-free (stdlib sqlite3) so it works offline, including under
# the Mock provider, rather than requiring an embeddings API call.
import re
import sqlite3
from pathlib import Path
from typing import NamedTuple

EXCLUDED_DIRS = {'node_modules', '.git', 'dist', 'dist-ui', 'dist-electron', '__pycache__', '.venv', 'venv', '.firebase'}
MAX_FILE_BYTES = 200_000
MAX_INDEXED_FILES = 2000


class Match(NamedTuple):
    path: str
    snippet: str


def _iter_text_files(root: Path):
    count = 0
    for path in root.rglob('*'):
        if count >= MAX_INDEXED_FILES:
            return
        if not path.is_file() or any(part in EXCLUDED_DIRS for part in path.parts):
            continue
        try:
            size = path.stat().st_size
            if size == 0 or size > MAX_FILE_BYTES:
                continue
            text = path.read_text(encoding='utf-8')
        except (OSError, UnicodeDecodeError):
            continue
        count += 1
        yield path.relative_to(root).as_posix(), text


def build_index(root: Path) -> sqlite3.Connection | None:
    conn = sqlite3.connect(':memory:')
    try:
        conn.execute('CREATE VIRTUAL TABLE files USING fts5(path, content)')
    except sqlite3.OperationalError:
        conn.close()
        return None
    conn.executemany('INSERT INTO files (path, content) VALUES (?, ?)', _iter_text_files(root))
    conn.commit()
    return conn


def _fts_query(task: str) -> str | None:
    words = re.findall(r'[A-Za-z0-9_]{2,}', task)
    if not words:
        return None
    return ' OR '.join(f'"{word}"' for word in words[:24])


def search(conn: sqlite3.Connection, task: str, limit: int = 5) -> list[Match]:
    query = _fts_query(task)
    if not query:
        return []
    try:
        rows = conn.execute(
            "SELECT path, snippet(files, 1, '', '', ' … ', 24) FROM files "
            "WHERE files MATCH ? ORDER BY bm25(files) LIMIT ?",
            (query, limit)
        ).fetchall()
    except sqlite3.OperationalError:
        return []
    return [Match(path=path, snippet=snippet) for path, snippet in rows]


def context_block(matches: list[Match]) -> str:
    if not matches:
        return ''
    parts = ['Relevant existing project context (retrieved, may be partial):']
    parts += [f'--- {match.path} ---\n{match.snippet}' for match in matches]
    return '\n\n'.join(parts)
