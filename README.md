# Kelus

Kelus is an Electron, Svelte, and Monaco desktop IDE with a Python agent backend. This first milestone provides a working project explorer with Devicon file icons, editor, integrated shell, and an agent workflow with explicit approval and recorded evidence.

## Run

Requires Node.js 20.19+ and Python 3.11+. On macOS, Windows, or Linux:

```sh
npm install
npm start
```

`npm start` builds the Electron and Svelte code and opens the desktop app. Open a project folder, edit files in Monaco, and save with Ctrl+S or Cmd+S. The interactive terminal starts in your home directory when Kelus opens and restarts in the project folder when one is opened. The Python backend starts automatically for each agent task; no separate server or Python packages are required.

If your shell has `ELECTRON_RUN_AS_NODE=1` set (as some coding-agent terminals do), unset it before launching Electron: `env -u ELECTRON_RUN_AS_NODE npm start` on macOS/Linux.

## Try the mock agent workflow

Without model credentials, the mock Coder accepts an explicit one-file task:

````text
Create file hello.py with
```python
print("hello")
```
````

Set the test command to `python3 hello.py` (`python hello.py` on Windows). Run agents, inspect the proposed diff, and approve the file write and command. The Tester records the actual exit code and output. The Reviewer checks the file and test result. Failed checks request up to two more revisions, then report failure and restore the original file. Individual test counts remain unavailable unless reported by a future test adapter. Without a test command, the result is `reviewed_without_tests`, never `verified`.

For broader coding tasks, set `KELUS_MODEL_URL`, `KELUS_MODEL_API_KEY`, and `KELUS_MODEL_NAME` to an OpenAI-compatible chat completions endpoint. The provider interface lives in `agent-engine/kelus_engine/provider.py`.

## Backend CLI and records

The desktop app starts `agent-engine/main.py` through JSON-lines IPC. To run it directly:

```sh
python3 agent-engine/main.py --workspace /path/to/project --task 'Create file hello.py with ...' --test-command 'python3 hello.py'
```

The CLI emits JSON lines and waits for `{"approved": true}` on stdin when it proposes a change. Runs are stored in SQLite at `~/.kelus/runs.db`, or `$KELUS_DATA_DIR/runs.db` if set. Export records with:

```sh
python3 agent-engine/main.py --export json --output runs.json
python3 agent-engine/main.py --export csv --output runs.csv
```

## Validate

```sh
npm run check
```

## Current limits

The mock model only handles explicit one-file content. Agent edits are one file per iteration. Packaging and signed installers are not yet configured. Token counts and costs remain unavailable when the provider does not report them. See [architecture decisions](docs/architecture.md).
