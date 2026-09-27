import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { type WebContents } from 'electron';
import { workspaceRoot } from './workspace';
import { teamEnvironment } from './settings';
import { defaultPython, enginePath } from './paths';

let agent: ChildProcessWithoutNullStreams | null = null;
export async function startAgent(task: string, testCommand: string, web: WebContents): Promise<void> {
  const root = workspaceRoot();
  if (!root) throw new Error('Open a project folder first');
  if (agent) throw new Error('An agent task is already running');
  const env = { ...process.env };
  delete env.KELUS_MODEL_URL; delete env.KELUS_MODEL_NAME; delete env.KELUS_MODEL_API_KEY; delete env.KELUS_TEAM;
  Object.assign(env, await teamEnvironment());
  const backend = enginePath('main.py');
  agent = spawn(defaultPython(), [backend, '--workspace', root, '--task', task, '--test-command', testCommand], {
    cwd: root, stdio: 'pipe', env
  });
  let buffer = '';
  agent.stdout.on('data', chunk => {
    buffer += chunk.toString();
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
      try { web.send('agent:event', JSON.parse(line)); }
      catch { web.send('agent:event', { type: 'error', message: `Invalid backend event: ${line}` }); }
    }
  });
  agent.stderr.on('data', chunk => web.send('agent:event', { type: 'log', message: chunk.toString() }));
  agent.on('error', error => web.send('agent:event', { type: 'error', message: error.message }));
  agent.on('exit', code => { web.send('agent:event', { type: 'exit', code }); agent = null; });
}
export function agentDecision(approved: boolean): void {
  if (!agent) throw new Error('No active agent task');
  agent.stdin.write(JSON.stringify({ approved }) + '\n');
}
export function stopAgent(): void { agent?.kill(); agent = null; }
