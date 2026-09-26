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

## Appearance

Every theme is a single block of CSS custom properties in `apps/desktop/ui/src/style.css` (`--bg-app`, `--text`, `--accent`, `--kind-claim`, etc.); every component rule reads only those variables, so adding a theme means adding one block, not hunting through selectors. `monaco.ts` and the terminal keep parallel per-theme color tables since Monaco and xterm.js don't consume CSS custom properties.

## Kelus Account and cloud sync

Kelus's account and cloud-sync layer is intentionally thin rather than pulling the Firebase Web SDK into Electron's main process:

- `apps/desktop/electron/account.ts` and `cloud.ts` call the Firebase Auth, Firestore, and Storage REST APIs directly with `fetch`. This avoids bundling a browser-oriented SDK into a Node context it wasn't built for, and keeps the attack surface (a handful of typed REST calls) easy to audit.
- The account website (`public/`) is a plain multi-page-feeling single HTML file with hash routing and no build step, using the real Firebase Web SDK from `gstatic.com` since it runs in an actual browser. It talks to the same `kelus-ide` Firebase project as the desktop app.
- Cloud sync zips the open project with `archiver` (pinned to the last CommonJS-compatible major, `^7.0.1` — archiver 8 moved to a Node-ESM-only build that doesn't `require()` from Electron's CommonJS main process), skipping `node_modules`, `.git`, build output, and `__pycache__`, uploads it to Storage at `users/{uid}/projects/{hash-of-project-path}.zip`, and upserts a matching Firestore document under `users/{uid}/projects/{id}`.
- Downloading extracts with `yauzl` plus an explicit path-containment and symlink-entry check (`extractZipSafely`), rather than `extract-zip`, which has an unpatched zip-slip/symlink advisory (GHSA-jmr9-qjv8-65gv) as of this writing.
- `firestore.rules` and `storage.rules` restrict all reads/writes to `request.auth.uid` matching the path's `{uid}` segment; Storage additionally caps individual uploads at 2 GiB.
- Firebase project `kelus-ide` was provisioned by script (`firebase projects:create`, then enabling `firestore.googleapis.com`/`identitytoolkit.googleapis.com`/`firebasestorage.googleapis.com` via the Service Usage API, then `firebase firestore:databases:create`). Two steps have no public API and need a one-time console click: enabling the Email/Password sign-in provider, and accepting the default Storage bucket. See the README's Kelus Account section for direct links.
