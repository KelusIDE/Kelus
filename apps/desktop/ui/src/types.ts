export type Entry = { name: string; path: string; directory: boolean; git?: string };
export type Theme = 'warm' | 'dark' | 'light' | 'midnight' | 'dracula' | 'nord' | 'solarized' | 'monokai' | 'high-contrast';
export type Locale = 'en' | 'ko' | 'fr' | 'es' | 'de' | 'ja' | 'zh';
export type Provider = 'mock' | 'openai-compatible';
export type ProviderProfile = { id: string; name: string; provider: Provider; modelUrl: string; modelName: string; hasApiKey: boolean };
export type Settings = {
  theme: Theme; locale: Locale; activeProfileId: string; profiles: ProviderProfile[];
  keyStorage: 'encrypted' | 'session-only';
};
export type ProviderProfileInput = { id: string; name: string; provider: Provider; modelUrl: string; modelName: string; apiKey?: string; clearApiKey?: boolean };
export type SettingsUpdate = {
  theme: Theme; locale: Locale; activeProfileId: string; profiles: ProviderProfileInput[];
};
export type GitSnapshot = { repository: boolean; branch: string; remote: string; changes: { path: string; status: string }[] };
export type GitHubStatus = { cliAvailable: boolean; connected: boolean; username: string };
/**
 * `kind` places an event on the evidence-based arbitration path described in the Kelus
 * design: a Coder claim is checked against Tester evidence; a Reviewer that disagrees
 * produces a counterargument (rendered muted/grey as an in-progress debate); Judge then
 * decides from the accumulated evidence. Events without a kind are plain status/log lines.
 */
export type AgentEventKind = 'claim' | 'evidence' | 'counterargument' | 'decision';
export type AgentEvent = {
  type: 'agent' | 'approval' | 'summary' | 'error' | 'log' | 'exit';
  agent?: string; model?: string; status?: string; message?: string; evidence?: Record<string, unknown>;
  kind?: AgentEventKind; debate?: boolean;
  path?: string; before?: string | null; after?: string; test_command?: string | null;
  record?: RunRecord; code?: number;
};
export type RunRecord = {
  task_id: string; agents_used: string[]; models: Record<string, string>;
  model_calls: number; input_tokens: number | null; output_tokens: number | null;
  runtime_seconds: number | null; estimated_cost: number | null;
  files_changed: string[]; tests_passed: number | null; tests_total: number | null; test_exit_code: number | null;
  security_findings: number | null; disagreements: number; revisions: number;
  final_outcome: string;
};
export type Account = { uid: string; email: string; displayName: string } | null;
export type CloudProject = {
  id: string; name: string; sizeBytes: number; updatedAt: string; repo: string; repoUrl: string;
};
export type SyncProgress = { phase: 'preparing' | 'pushing' | 'writing-record' | 'done'; percent?: number };
export type SyncResult = CloudProject & { skipped: string[]; changed: boolean };
export type GithubConnectEvent = { status: 'connected'; login: string } | { status: 'error'; message: string };
export type KelusAPI = {
  platform: string;
  openWorkspace(): Promise<string | null>; getRoot(): Promise<string | null>;
  listFiles(path?: string): Promise<Entry[]>; readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, directory: boolean): Promise<void>;
  renameEntry(from: string, to: string): Promise<void>; deleteEntry(path: string): Promise<void>;
  startTerminal(cols: number, rows: number): Promise<void>; writeTerminal(data: string): void;
  resizeTerminal(cols: number, rows: number): void;
  onTerminalData(callback: (data: string) => void): () => void;
  startTask(task: string, testCommand: string): Promise<void>;
  decide(approved: boolean): Promise<void>;
  getSettings(): Promise<Settings>; updateSettings(value: SettingsUpdate): Promise<Settings>;
  gitStatus(): Promise<GitSnapshot>; gitInit(): Promise<GitSnapshot>;
  gitSetOrigin(url: string): Promise<GitSnapshot>;
  gitCommit(message: string, paths: string[]): Promise<GitSnapshot>; gitPush(): Promise<void>;
  githubStatus(): Promise<GitHubStatus>; githubDownload(): Promise<void>;
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
  accountCurrent(): Promise<Account>;
  accountSignUp(email: string, password: string, displayName: string): Promise<Account>;
  accountSignIn(email: string, password: string): Promise<Account>;
  accountSignOut(): Promise<void>;
  accountSignInWithBrowser(provider: 'google' | 'github'): Promise<Account>;
  accountCancelBrowser(): Promise<void>;
  cloudList(): Promise<CloudProject[]>;
  cloudSync(): Promise<SyncResult>;
  githubAccount(): Promise<{ login: string } | null>;
  githubConnect(): Promise<{ userCode: string; verificationUri: string }>;
  githubCancelConnect(): Promise<void>;
  githubDisconnect(): Promise<void>;
  onGithubConnect(callback: (event: GithubConnectEvent) => void): () => void;
  cloudDownload(projectId: string): Promise<string | null>;
  cloudDelete(projectId: string): Promise<void>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
  agentConfig(): Promise<AgentConfig>;
  updateAgentConfig(value: AgentConfig): Promise<AgentConfig>;
  computerPermissions(): Promise<ComputerPermissions>;
  computerOpenPermission(kind: 'screen' | 'accessibility'): Promise<void>;
  computerStart(task: string): Promise<void>;
  computerDecide(approved: boolean): Promise<void>;
  computerStop(): Promise<void>;
  onComputerEvent(callback: (event: ComputerEvent) => void): () => void;
  kernelInterpreters(notebook: string): Promise<Interpreter[]>;
  kernelStart(notebook: string, python?: string): Promise<{ python: string }>;
  kernelExecute(notebook: string, cell: string, code: string): Promise<void>;
  kernelInterrupt(notebook: string): Promise<void>;
  kernelRestart(notebook: string): Promise<void>;
  kernelShutdown(notebook: string): Promise<void>;
  onKernelEvent(callback: (event: KernelEvent) => void): () => void;
};
export type Interpreter = { path: string; label: string; version: string };
export type AgentConfig = {
  debate: boolean; coderId: string; criticIds: string[]; judgeId: string;
  panel: boolean; panelIds: string[]; panelRounds: number;
  computer: { enabled: boolean; profileId: string; confirmEachAction: boolean; maxSteps: number };
};
export type ComputerPermissions = { supported: boolean; screen: string; accessibility: boolean };
export type ComputerEvent =
  | { type: 'status'; running: boolean; model?: string; dryRun?: boolean }
  | { type: 'screenshot'; step: number; preview: string }
  | { type: 'step'; step: number; thought: string; description: string; invalid?: boolean }
  | { type: 'approval'; step: number; description: string; thought: string }
  | { type: 'done' | 'failed'; summary?: string }
  | { type: 'stopped'; reason: string }
  | { type: 'error'; message: string };
export type NotebookOutput = {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  name?: string; text?: string | string[];
  data?: Record<string, unknown>; metadata?: Record<string, unknown>; execution_count?: number | null;
  ename?: string; evalue?: string; traceback?: string[];
};
export type KernelState = 'starting' | 'idle' | 'busy' | 'restarting' | 'dead';
export type KernelEvent = { path: string } & (
  | { event: 'status'; state: KernelState }
  | { event: 'ready'; python: string; version: string }
  | { event: 'missing'; packages: string[]; python: string }
  | { event: 'error'; message: string }
  | { event: 'count'; cell: string; count: number }
  | { event: 'output'; cell: string; output: NotebookOutput; display_id: string | null }
  | { event: 'update'; display_id: string; output: NotebookOutput }
  | { event: 'clear'; cell: string; wait: boolean }
  | { event: 'done'; cell: string; status: 'ok' | 'aborted' }
);
declare global { interface Window { kelus: KelusAPI } }
