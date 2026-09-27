import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type WebContents } from 'electron';
import { resolveInside, workspaceRoot } from './workspace';
import { enginePath } from './paths';

const execFileAsync = promisify(execFile);
export type Interpreter = { path: string; label: string; version: string };
type Session = { process: ChildProcessWithoutNullStreams; python: string; stdoutBuffer: string; stderrTail: string };

const sessions = new Map<string, Session>();
const chosen = new Map<string, string>();
let shellPython: Promise<string | null> | null = null;

const binPython = (prefix: string) => process.platform === 'win32' ? path.join(prefix, 'python.exe') : path.join(prefix, 'bin', 'python');
const venvPython = (dir: string) => process.platform === 'win32' ? path.join(dir, 'Scripts', 'python.exe') : path.join(dir, 'bin', 'python');

async function exists(file: string): Promise<boolean> {
  try { return (await fs.stat(file)).isFile(); } catch { return false; }
}
async function subdirectories(dir: string): Promise<string[]> {
  try { return (await fs.readdir(dir, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => path.join(dir, e.name)); }
  catch { return []; }
}
function loginShellPython(): Promise<string | null> {
  if (process.platform === 'win32') return Promise.resolve(null);
  shellPython ??= execFileAsync(process.env.SHELL || '/bin/zsh', ['-ilc', 'command -v python3'], { timeout: 8000 })
    .then(({ stdout }) => stdout.trim().split('\n').at(-1)?.trim() || null).catch(() => null);
  return shellPython;
}
async function version(python: string): Promise<string | null> {
  try { return (await execFileAsync(python, ['-c', 'import sys;print(sys.version.split()[0])'], { timeout: 8000 })).stdout.trim(); }
  catch { return null; }
}

export async function listInterpreters(notebook: string): Promise<Interpreter[]> {
  const root = workspaceRoot();
  const candidates: { path: string; label: string }[] = [];
  if (root) {
    const notebookDir = path.dirname(await resolveInside(notebook));
    const dirs: string[] = [];
    for (let dir = notebookDir; ; dir = path.dirname(dir)) { dirs.push(dir); if (dir === root || dir === path.dirname(dir)) break; }
    for (const dir of dirs) for (const name of ['.venv', 'venv', 'env', '.env']) {
      candidates.push({ path: venvPython(path.join(dir, name)), label: path.relative(root, path.join(dir, name)) || name });
    }
  }
  if (process.env.KELUS_PYTHON) candidates.push({ path: process.env.KELUS_PYTHON, label: 'KELUS_PYTHON' });
  const home = os.homedir();
  for (const base of ['anaconda3', 'miniconda3', 'miniforge3', 'mambaforge', 'opt/anaconda3', 'opt/miniconda3']) {
    const prefix = path.join(home, base);
    candidates.push({ path: binPython(prefix), label: `conda: base (${base.split('/').at(-1)})` });
    for (const env of await subdirectories(path.join(prefix, 'envs'))) candidates.push({ path: binPython(env), label: `conda: ${path.basename(env)}` });
  }
  const fromShell = await loginShellPython();
  if (fromShell) candidates.push({ path: fromShell, label: 'shell python3' });
  if (process.platform !== 'win32') for (const file of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']) candidates.push({ path: file, label: file });

  const seen = new Set<string>();
  const unique = [];
  for (const candidate of candidates) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (await exists(candidate.path)) unique.push(candidate);
  }
  const versions = await Promise.all(unique.map(c => version(c.path)));
  return unique.flatMap((c, i) => versions[i] ? [{ ...c, version: versions[i]! }] : []);
}

export async function startKernel(web: WebContents, notebook: string, python?: string): Promise<{ python: string }> {
  const root = workspaceRoot();
  if (!root) throw new Error('Open a project folder first');
  const cwd = path.dirname(await resolveInside(notebook));
  if (python) chosen.set(notebook, python);
  const selected = python || chosen.get(notebook) || (await listInterpreters(notebook))[0]?.path;
  if (!selected) throw new Error('No Python interpreter found. Install Python 3 or create a .venv in the project.');
  const running = sessions.get(notebook);
  if (running && running.python === selected) return { python: selected };
  shutdownKernel(notebook);
  chosen.set(notebook, selected);

  const bridge = enginePath('kernel_bridge.py');
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONUNBUFFERED: '1' };
  env.PATH = [path.dirname(selected), env.PATH].filter(Boolean).join(path.delimiter);
  delete env.PYTHONHOME;
  const child = spawn(selected, [bridge, '--cwd', cwd], { cwd, env, stdio: 'pipe' });
  const session: Session = { process: child, python: selected, stdoutBuffer: '', stderrTail: '' };
  sessions.set(notebook, session);
  const send = (event: Record<string, unknown>) => { if (!web.isDestroyed()) web.send('kernel:event', { ...event, path: notebook }); };

  child.stdout.on('data', chunk => {
    session.stdoutBuffer += chunk.toString();
    let newline: number;
    while ((newline = session.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = session.stdoutBuffer.slice(0, newline); session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1);
      if (!line.trim()) continue;
      try { send(JSON.parse(line)); } catch { send({ event: 'error', message: `Invalid kernel event: ${line.slice(0, 200)}` }); }
    }
  });
  child.stderr.on('data', chunk => { session.stderrTail = (session.stderrTail + chunk.toString()).slice(-4000); });
  child.stdin.on('error', () => { /* bridge already exited; the exit handler reports it */ });
  child.on('error', error => send({ event: 'error', message: error.message }));
  child.on('exit', code => {
    if (sessions.get(notebook) !== session) return;
    sessions.delete(notebook);
    if (code && code !== 2) send({ event: 'error', message: `Kernel bridge exited (${code}).\n${session.stderrTail.trim().split('\n').slice(-8).join('\n')}` });
    send({ event: 'status', state: 'dead' });
  });
  return { python: selected };
}

function command(notebook: string, value: Record<string, unknown>): void {
  const session = sessions.get(notebook);
  if (!session) throw new Error('Kernel is not running');
  session.process.stdin.write(JSON.stringify(value) + '\n');
}
export function execute(notebook: string, cell: string, code: string): void { command(notebook, { op: 'execute', cell, code }); }
export function interrupt(notebook: string): void { command(notebook, { op: 'interrupt' }); }
export function restart(notebook: string): void { command(notebook, { op: 'restart' }); }
export function shutdownKernel(notebook: string): void {
  const session = sessions.get(notebook);
  if (!session) return;
  sessions.delete(notebook);
  try { session.process.stdin.write(JSON.stringify({ op: 'shutdown' }) + '\n'); session.process.stdin.end(); } catch { /* already gone */ }
  setTimeout(() => { if (session.process.exitCode === null) session.process.kill(); }, 5000);
}
export function stopAll(): void { for (const notebook of [...sessions.keys()]) shutdownKernel(notebook); chosen.clear(); }
