import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
export type GitChange = { path: string; status: string };
export type GitSnapshot = { repository: boolean; branch: string; remote: string; changes: GitChange[] };

async function git(root: string, args: string[], timeout = 15000): Promise<string> {
  const { stdout } = await run('git', args, { cwd: root, timeout, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}
export async function snapshot(root: string): Promise<GitSnapshot> {
  try { await git(root, ['rev-parse', '--is-inside-work-tree']); }
  catch { return { repository: false, branch: '', remote: '', changes: [] }; }
  const branch = (await git(root, ['branch', '--show-current']).catch(() => '')).trim();
  const remote = (await git(root, ['remote', 'get-url', 'origin']).catch(() => '')).trim();
  const raw = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = raw.split('\0').filter(Boolean);
  const changes: GitChange[] = [];
  for (let i = 0; i < parts.length; i++) {
    const item = parts[i];
    const status = item.slice(0, 2);
    const path = item.slice(3);
    if (status.includes('R') || status.includes('C')) i++; // The next NUL field is the old path.
    changes.push({ path, status });
  }
  return { repository: true, branch, remote, changes };
}
export async function init(root: string): Promise<GitSnapshot> {
  await git(root, ['init']);
  return snapshot(root);
}
export async function setOrigin(root: string, url: string): Promise<GitSnapshot> {
  const value = url.trim();
  if (!/^(https:\/\/github\.com\/[^\s]+|git@github\.com:[^\s]+)$/.test(value)) throw new Error('Enter a GitHub repository URL');
  const current = await snapshot(root);
  if (!current.repository) throw new Error('Initialize Git first');
  await git(root, current.remote ? ['remote', 'set-url', 'origin', value] : ['remote', 'add', 'origin', value]);
  return snapshot(root);
}
export async function commit(root: string, message: string, paths: string[]): Promise<GitSnapshot> {
  if (!message.trim()) throw new Error('Enter a commit message');
  const current = await snapshot(root);
  if (!current.repository) throw new Error('Initialize Git first');
  const allowed = new Set(current.changes.map(change => change.path));
  if (!paths.length || paths.some(path => !allowed.has(path))) throw new Error('Select changed files to commit');
  const literals = paths.map(path => `:(literal)${path}`);
  await git(root, ['add', '-A', '--', ...literals]);
  await git(root, ['commit', '--only', '-m', message.trim(), '--', ...literals], 60000);
  return snapshot(root);
}
export async function push(root: string): Promise<void> {
  const current = await snapshot(root);
  if (!current.repository || !current.remote) throw new Error('Add an origin remote before pushing');
  if (!current.branch) throw new Error('Check out a branch before pushing');
  await git(root, ['push', '-u', 'origin', current.branch], 120000);
}
export async function githubStatus(): Promise<{ cliAvailable: boolean; connected: boolean; username: string }> {
  try {
    const { stdout } = await run('gh', ['api', 'user', '--jq', '.login'], { timeout: 10000 });
    return { cliAvailable: true, connected: true, username: stdout.trim() };
  } catch (error) {
    return { cliAvailable: (error as NodeJS.ErrnoException).code !== 'ENOENT', connected: false, username: '' };
  }
}
