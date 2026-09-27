# Architecture decisions

## First milestone path

Goal → Orchestrator → Coder → approval → file write → Tester → Reviewer → revision or outcome.

- `apps/desktop/electron`: desktop lifecycle, narrow renderer IPC, workspace access, node-pty terminal process, Python process.
- `apps/desktop/ui`: Svelte interface, Monaco editor and diff view, terminal, Agent Room and verification summary.
- `agent-engine/kelus_engine`: provider protocol, execution permission boundary, workflow, SQLite history.

Electron keeps Node access out of the renderer. Workspace operations reject parent traversal and symlinks that resolve outside the opened folder. The Python execution service checks paths again. Agent writes and test commands require an explicit approval message tied to the displayed proposal. Test commands run without a shell, with a 120 second timeout. The user operated terminal is a separate PTY started in the home directory and restarted in the project folder when one opens. The post-install script ensures node-pty's Unix helper is executable. The app icon assets are in `assets/icons`.

The Orchestrator allocates Coder and Reviewer for a task, adding Tester when a test command is supplied. This is intentionally small but represented as a list in each run so later experiments can vary agent composition. Reviewer decisions depend on the actual file and test output. A failed review returns feedback to Coder for up to two revisions. The mock provider can only reproduce explicit code supplied by the user; it never invents an implementation.

SQLite stores per-run task, agent list, provider models, calls, tokens when reported, runtime, files changed, test command exit code and output, disagreements, revisions, and outcome. Unknown metrics, including individual test counts, are NULL. JSON and CSV exports preserve these records for future experiments. Estimated cost remains NULL until model pricing is configured. Unsuccessful runs restore their original files.

Security, Architect, Performance, and Requirement Reviewer agents are beyond this milestone. A **Judge** role was split out of the Orchestrator: the Orchestrator still only plans agent allocation, and Judge is the one that reads Tester evidence and Reviewer's counterargument (if any) and decides to pass, request a revision, or report failed verification (`workflow.py`, the `event()` calls tagged `kind='decision'`). Every Agent Room event now carries an optional `kind` (`claim` | `evidence` | `counterargument` | `decision`) so the UI can show the arbitration path explicitly instead of an undifferentiated log, and a `debate` flag that renders Reviewer counterarguments in muted grey text. Full Architect/Security/Performance/Requirement-Reviewer agents, role-specific model contexts, project-wide test discovery, structured test case counts, and packaged installers remain future work.

## Retrieval (RAG)

Before the Coder's first attempt, `workflow.py` builds an in-memory SQLite FTS5 index (`kelus_engine/retrieval.py`) over the open project's own text files (skipping `node_modules`, `.git`, build output, `__pycache__`, `.venv`/`venv`, files over 200 KB, and capping at 2000 indexed files) and runs the task text against it as a keyword search, ranked by BM25. This is lexical retrieval, not embeddings: it needs no model API call, works fully offline including under the Mock provider, and keeps the engine dependency-free (`sqlite3`'s FTS5 module ships with the Python interpreter). Matched file excerpts are appended to the Coder's prompt as retrieved context, so the Coder isn't blind to the rest of the project the way it was before. A `Retriever` event (no `kind` — it precedes the claim/evidence/counterargument/decision arbitration path, it doesn't participate in it) reports what was found; matched paths are stored per run as `rag_sources` and exported like every other field. If the platform's SQLite build lacks FTS5, retrieval silently no-ops and the run proceeds exactly as it did before this existed.

## Appearance

Every theme is a single block of CSS custom properties in `apps/desktop/ui/src/style.css` (`--bg-app`, `--text`, `--accent`, `--kind-claim`, etc.); every component rule reads only those variables, so adding a theme means adding one block, not hunting through selectors. `monaco.ts` and the terminal keep parallel per-theme color tables since Monaco and xterm.js don't consume CSS custom properties.

## Kelus Account and cloud sync

Kelus's account and cloud-sync layer is intentionally thin rather than pulling the Firebase Web SDK into Electron's main process. File bytes for synced projects live in a private repo on the **user's own GitHub account**, not on Firebase or any storage Kelus pays for: Firebase Storage needs a billing account, and any shared storage key bundled into a desktop app can be extracted by anyone who downloads it.

- `apps/desktop/electron/account.ts` and `cloud.ts` call the Firebase Auth and Firestore REST APIs directly with `fetch`; this avoids bundling a browser-oriented SDK into a Node context it wasn't built for, and keeps the attack surface (a handful of typed REST calls) easy to audit.
- `apps/desktop/electron/github.ts` connects GitHub with the OAuth device flow (public client ID only, `repo` scope). `syncGit.ts` keeps one private git dir per local folder under the app's user data, with the project folder as work tree: `git add --all` into that private index (honouring `.gitignore` plus a built-in exclude list for dependencies, build output and secret-bearing files), `write-tree`, then `commit-tree` on top of the fetched remote tip, so every push is a fast-forward. The token travels as an `http.extraheader`, never in config or URLs, and is scrubbed from error messages. Hooks, signing and autocrlf from the user's global config are disabled for these commands.
- Firestore stores only the listing (`users/{uid}/projects/{id}`: name, size, timestamp, repo, repo URL). The account website (`public/`) reads that list with the Firebase Web SDK and links to the repo; its "remove" deletes only the listing.
- `firestore.rules` restricts all reads/writes to `request.auth.uid` matching the path's `{uid}` segment. Repo privacy is GitHub's (repos are created private).
- Firebase project `kelus-ide` was provisioned by script (`firebase projects:create`, then enabling `firestore.googleapis.com`/`identitytoolkit.googleapis.com` via the Service Usage API, then `firebase firestore:databases:create`). One step has no public API and needs a one-time console click: enabling the Email/Password sign-in provider. See the README's Kelus Account section for the direct link.
