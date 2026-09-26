export type Entry = { name: string; path: string; directory: boolean; git?: string };
export type Theme = 'warm' | 'dark' | 'light' | 'midnight' | 'dracula' | 'nord' | 'solarized' | 'monokai' | 'high-contrast';
export type Locale = 'en' | 'ko' | 'fr' | 'es' | 'de' | 'ja' | 'zh';
export type Provider = 'mock' | 'openai-compatible';
export type ProviderProfile = { id: string; name: string; provider: Provider; modelUrl: string; modelName: string; hasApiKey: boolean };
export type Settings = { theme: Theme; locale: Locale; activeProfileId: string; profiles: ProviderProfile[]; keyStorage: 'encrypted' | 'session-only' };
export type ProviderProfileInput = { id: string; name: string; provider: Provider; modelUrl: string; modelName: string; apiKey?: string; clearApiKey?: boolean };
export type SettingsUpdate = { theme: Theme; locale: Locale; activeProfileId: string; profiles: ProviderProfileInput[] };
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
  agent?: string; status?: string; message?: string; evidence?: Record<string, unknown>;
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
  id: string; name: string; sizeBytes: number; updatedAt: string; storagePath: string;
};
export type SyncProgress = { phase: 'zipping' | 'uploading' | 'writing-record' | 'done'; percent?: number };
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
  cloudList(): Promise<CloudProject[]>;
  cloudSync(): Promise<CloudProject>;
  cloudDownload(projectId: string): Promise<string | null>;
  cloudDelete(projectId: string): Promise<void>;
  onSyncProgress(callback: (progress: SyncProgress) => void): () => void;
};
declare global { interface Window { kelus: KelusAPI } }
