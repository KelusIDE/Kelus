import * as pty from 'node-pty';
import { app, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

let terminal: pty.IPty | null = null;
let terminalOwner: WebContents | null = null;
export function startTerminal(web: WebContents, root: string | null, cols = 80, rows = 24): void {
  stopTerminal();
  const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
  const cwd = root || app.getPath('home');
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'Kelus';
  const instance = pty.spawn(shell, [], { name: 'xterm-256color', cols: Math.max(2, cols), rows: Math.max(2, rows), cwd, env });
  terminal = instance;
  terminalOwner = web;
  instance.onData(data => { if (!web.isDestroyed()) web.send('terminal:data', data); });
  instance.onExit(({ exitCode }) => {
    if (terminal === instance) {
      terminal = null;
      if (!web.isDestroyed()) web.send('terminal:data', `\r\n[terminal exited: ${exitCode}]\r\n`);
    }
  });
}
export function writeTerminal(data: string): void {
  if (terminal) terminal.write(data);
  else if (terminalOwner && !terminalOwner.isDestroyed()) terminalOwner.send('terminal:data', '\r\n[terminal unavailable]\r\n');
}
export function resizeTerminal(cols: number, rows: number): void {
  if (terminal && Number.isInteger(cols) && Number.isInteger(rows) && cols > 1 && rows > 1) terminal.resize(cols, rows);
}
export function stopTerminal(): void { terminal?.kill(); terminal = null; terminalOwner = null; }

export async function readGitStatus(root: string): Promise<Map<string, string>> {
  const status = new Map<string, string>();
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: root, timeout: 3000 });
    for (const line of stdout.split('\n')) {
      if (!line) continue;
      const file = line.slice(3).replace(/^"|"$/g, '').split('/')[0];
      status.set(file, line.slice(0, 2).trim() || 'modified');
    }
  } catch { /* Folders without Git have no indicators. */ }
  return status;
}
