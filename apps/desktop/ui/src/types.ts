export type Entry = { name: string; path: string; directory: boolean; git?: string };
export type AgentEvent = {
  type: 'agent' | 'approval' | 'summary' | 'error' | 'log' | 'exit';
  agent?: string; status?: string; message?: string; evidence?: Record<string, unknown>;
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
  onAgentEvent(callback: (event: AgentEvent) => void): () => void;
};
declare global { interface Window { kelus: KelusAPI } }
