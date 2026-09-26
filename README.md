# Kelus

Kelus is an Electron, Svelte, and Monaco desktop IDE with a Python agent backend. It includes a project explorer with Devicon file icons, syntax highlighting, an integrated shell, source control, and an agent workflow with explicit approval and recorded evidence.

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

For broader coding tasks, open **Settings** (gear icon), select **OpenAI compatible API**, and enter the chat completions endpoint, model ID, and API key. Kelus encrypts the key using the operating system's secure storage where available. If secure storage is unavailable, the key stays in memory until Kelus exits. The provider interface lives in `agent-engine/kelus_engine/provider.py`. The backend CLI still accepts `KELUS_MODEL_URL`, `KELUS_MODEL_API_KEY`, and `KELUS_MODEL_NAME` environment variables.

## Agent Room: claim, evidence, counterargument, decision

Each Agent Room entry is tagged with where it sits on the evidence-based arbitration path instead of appearing as an undifferentiated log:

- **Claim** — the Coder proposing or revising a candidate change.
- **Evidence** — the Tester's actual exit code and output, or the Reviewer independently endorsing the candidate.
- **Counterargument** — the Reviewer rejecting a candidate. These entries render with muted, grey message text so an in-progress disagreement reads differently from a settled fact.
- **Decision** — the **Judge** resolving the run from the accumulated evidence: pass, request a revision, or report failed verification. The Judge is a distinct role from the Orchestrator (which only plans agent allocation) so the moment of arbitration is visible on its own.

This mirrors the `Claim → Evidence → Counterargument → Judge decision` pattern rather than a majority vote; see [`workflow.py`](agent-engine/kelus_engine/workflow.py) for exactly where each tag is emitted.

## Appearance and GitHub

Settings offers nine color themes: Kelus Warm, Dark, Light, Midnight, Dracula, Nord, Solarized, Monokai, and High Contrast, shown as swatches you can click. Every theme is a single block of CSS custom properties in [`style.css`](apps/desktop/ui/src/style.css) — add a theme by adding one more block, no other file needs scattered edits. Monaco and the integrated terminal follow the same theme. Monaco highlights common source files, including TypeScript, JavaScript, Python, HTML, CSS, JSON, shell scripts, SQL, Rust, Go, Perl, R, Objective-C, Scala, Elixir, F#, GraphQL, and more (see [`language.ts`](apps/desktop/ui/src/language.ts) for the full extension map).

Settings also offers a **Language** selector for the Kelus interface itself: English, 한국어, Français, Español, Deutsch, 日本語, and 中文. It changes menus, buttons, and labels throughout the desktop app immediately (no restart) and persists like the theme choice. Translations live in [`i18n.svelte.ts`](apps/desktop/ui/src/i18n.svelte.ts); text that agents or the backend generate at runtime (task results, error messages, Git output) stays in English, since that's generated prose rather than fixed UI copy.

Open **Source Control** from the activity bar after opening a project folder. Initialize Git if needed, select changed files, enter a message, and commit. Enter a GitHub repository URL as the origin remote to enable **Push to origin**. Pushing asks for confirmation. Git also needs a configured author name and email (`git config --global user.name` and `git config --global user.email`).

GitHub sign-in uses the official GitHub CLI (`gh`). Install it if the Source Control view prompts you, then choose **Sign in with GitHub**. Kelus runs `gh auth login` in the integrated terminal and configures Git authentication with `gh auth setup-git`; choose **Check connection** after sign-in. Kelus does not store a GitHub access token itself.

## Kelus Account and cloud sync

Kelus can sync a project's files to Kelus Cloud (Firebase project `kelus-ide`) so you have an off-device copy once a project grows past what you want to keep only on one machine — there's no size gate; the **Sync to Cloud** button in the **Account** view (the icon above Settings in the activity bar) is always available once you're signed in and a project is open.

1. Open the **Account** view and create an account or sign in (email + password).
2. With a project folder open, click **Sync to Cloud**. Kelus zips the project (excluding `node_modules`, `.git`, build output, and `__pycache__`), uploads it, and records it in your account.
3. Manage synced projects from the same view (download, delete) or from the account website at **https://kelus-ide.web.app** — sign in there to see the same list, download a `.zip`, or delete a project from any browser.

Implementation notes:

- The Electron main process talks to Firebase Auth, Firestore, and Storage over their REST APIs directly (`apps/desktop/electron/account.ts`, `apps/desktop/electron/cloud.ts`) rather than embedding the Firebase Web SDK in a Node process it wasn't designed for. The account website (`public/`) uses the real Firebase Web SDK, loaded from `gstatic.com`, since it runs in a browser.
- The refresh token is stored encrypted with the OS's secure storage (same mechanism as the model API key in Settings), and only the short-lived ID token is kept in memory.
- Downloading a synced project extracts the zip with an explicit zip-slip and symlink-entry guard (`extractZipSafely` in `cloud.ts`) rather than trusting a third-party extractor; see [Development rules](docs/architecture.md) for why.
- Firestore and Storage security rules (`firestore.rules`, `storage.rules`) restrict every read and write to the signed-in user's own `users/{uid}` subtree — deployed with `firebase deploy --only firestore:rules,storage:rules`.
- **One-time setup required in the Firebase console** before sign-up/sign-in or sync will work — this project's Auth and Storage products were provisioned by script but each needs one manual "Get started" click that Firebase does not expose over any public API:
  - Authentication → **Get started** → enable the **Email/Password** provider: <https://console.firebase.google.com/project/kelus-ide/authentication>
  - Storage → **Get started** (accept the default bucket): <https://console.firebase.google.com/project/kelus-ide/storage>

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

The mock model only handles explicit one-file content. Agent edits are one file per iteration. Packaging and signed installers are not yet configured. Token counts and costs remain unavailable when the provider does not report them. Authentication and Storage need the one-time console step above before cloud sync works. Cloud sync uploads a full re-zip each time (no incremental/delta sync) and there's no progress cancellation once an upload starts. The account website has no password-reset flow yet. See [architecture decisions](docs/architecture.md).
