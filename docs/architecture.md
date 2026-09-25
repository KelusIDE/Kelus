# Architecture decisions

## First milestone path

Goal → Orchestrator → Coder → approval → file write → Tester → Reviewer → revision or outcome.

- `apps/desktop/electron`: desktop lifecycle, narrow renderer IPC, workspace access, node-pty terminal process, Python process.
- `apps/desktop/ui`: Svelte interface, Monaco editor and diff view, terminal, Agent Room and verification summary.
- `agent-engine/kelus_engine`: provider protocol, execution permission boundary, workflow, SQLite history.

Electron keeps Node access out of the renderer. Workspace operations reject parent traversal and symlinks that resolve outside the opened folder. The Python execution service checks paths again. Agent writes and test commands require an explicit approval message tied to the displayed proposal. Test commands run without a shell, with a 120 second timeout. The user operated terminal is a separate PTY started in the home directory and restarted in the project folder when one opens. The post-install script ensures node-pty's Unix helper is executable. The app icon assets are in `assets/icons`.

The Orchestrator allocates Coder and Reviewer for a task, adding Tester when a test command is supplied. This is intentionally small but represented as a list in each run so later experiments can vary agent composition. Reviewer decisions depend on the actual file and test output. A failed review returns feedback to Coder for up to two revisions. The mock provider can only reproduce explicit code supplied by the user; it never invents an implementation.

SQLite stores per-run task, agent list, provider models, calls, tokens when reported, runtime, files changed, test command exit code and output, disagreements, revisions, and outcome. Unknown metrics, including individual test counts, are NULL. JSON and CSV exports preserve these records for future experiments. Estimated cost remains NULL until model pricing is configured. Unsuccessful runs restore their original files.

Security, Architect, Performance, Requirement Reviewer, and Judge agents are beyond this milestone. The current Orchestrator handles the review/test gate, and Reviewer is independent at the provider-call level. Future work should add role-specific model contexts and a Judge for evidence-based disagreement resolution. Project-wide test discovery, structured test case counts, Git operations, durable per-agent transcripts, and packaged installers are also future work.
