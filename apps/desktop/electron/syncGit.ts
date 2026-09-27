/**
 * Git plumbing for Kelus Cloud sync (no Electron imports, so it is testable with plain Node).
 * Each project gets a private git directory in Kelus's app data with the project folder as its
 * work tree, so syncing never creates a .git folder in the project or touches the user's own
 * branches, index or commits. Every sync snapshots the folder as one commit on top of whatever
 * is on the remote, so the push is always a fast-forward and the latest sync wins.
 */
import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Always left out: rebuildable folders, OS junk and anything that usually holds secrets. */
export const DEFAULT_EXCLUDES = [
  'node_modules/', '.venv/', 'venv/', '__pycache__/', '*.pyc', '.ipynb_checkpoints/', '.DS_Store', 'Thumbs.db',
  'dist/', 'dist-electron/', 'dist-ui/', 'release/', '.next/', '.cache/',
  '.env', '.env.*', '!.env.example', '*.pem', '*.key', '*.p12', 'id_rsa*', 'id_ed25519*', '.npmrc', '.pypirc'
];
/** GitHub rejects files over 100 MB. */
export const MAX_FILE_BYTES = 95 * 1024 * 1024;

export type SyncTarget = {
  root: string; gitDir: string; remote: string;
  /** Base64 of "x-access-token:<token>", sent as an HTTP header so it is never written to git config or URLs. */
  auth?: string;
};
export type SnapshotResult = { commit: string; changed: boolean; files: number; bytes: number; skipped: string[] };

function gitArgs(target: SyncTarget, args: string[]): string[] {
  return [
    '--git-dir', target.gitDir, '--work-tree', target.root,
    // Ignore the user's global hooks, signing and line-ending settings: this is a private mirror, not their repo.
    '-c', 'core.quotepath=off', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false',
    '-c', `core.hooksPath=${path.join(target.gitDir, 'no-hooks')}`,
    ...(target.auth ? ['-c', `http.extraheader=AUTHORIZATION: basic ${target.auth}`] : []),
    ...args
  ];
}
async function git(target: SyncTarget, args: string[], env: Record<string, string> = {}): Promise<string> {
  try {
    const { stdout } = await run('git', gitArgs(target, args), {
      maxBuffer: 512 * 1024 * 1024, cwd: target.root, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env }
    });
    return stdout;
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr || (error as Error).message);
    // Never echo the auth header back to the UI.
    throw new Error(stderr.replace(/basic [A-Za-z0-9+/=]+/g, 'basic ***').trim());
  }
}
const quiet = (promise: Promise<string>) => promise.then(value => value.trim()).catch(() => '');

export async function ensureRepo(target: SyncTarget): Promise<void> {
  try { await fs.access(path.join(target.gitDir, 'HEAD')); }
  catch {
    await fs.mkdir(target.gitDir, { recursive: true });
    await run('git', ['--git-dir', target.gitDir, 'init', '--quiet', '--initial-branch=main']);
  }
  await fs.mkdir(path.join(target.gitDir, 'info'), { recursive: true });
  await fs.writeFile(path.join(target.gitDir, 'info', 'exclude'), DEFAULT_EXCLUDES.join('\n') + '\n');
  const current = await quiet(git(target, ['remote', 'get-url', 'origin']));
  if (!current) await git(target, ['remote', 'add', 'origin', target.remote]);
  else if (current !== target.remote) await git(target, ['remote', 'set-url', 'origin', target.remote]);
}

async function fetchRemoteTip(target: SyncTarget): Promise<string> {
  try { await git(target, ['fetch', '--quiet', '--no-tags', 'origin', 'main']); }
  catch (error) {
    // A brand-new empty repo has no main branch yet; anything else (auth, network) is a real failure.
    if (/couldn't find remote ref|could not find remote ref/i.test(String((error as Error).message))) return '';
    throw error;
  }
  return quiet(git(target, ['rev-parse', 'FETCH_HEAD']));
}

async function dropLargeFiles(target: SyncTarget, maxBytes: number): Promise<string[]> {
  const files = (await git(target, ['ls-files', '--cached', '-z'])).split('\0').filter(Boolean);
  const skipped: string[] = [];
  for (let i = 0; i < files.length; i += 64) {
    const batch = files.slice(i, i + 64);
    const sizes = await Promise.all(batch.map(file => fs.lstat(path.join(target.root, file)).then(s => s.size).catch(() => 0)));
    batch.forEach((file, index) => { if (sizes[index] > maxBytes) skipped.push(file); });
  }
  for (let i = 0; i < skipped.length; i += 100) await git(target, ['rm', '--cached', '--quiet', '--', ...skipped.slice(i, i + 100)]);
  return skipped;
}

export async function snapshotAndPush(target: SyncTarget, author: { name: string; email: string }, message: string,
  maxBytes = MAX_FILE_BYTES): Promise<SnapshotResult> {
  await ensureRepo(target);
  const remoteTip = await fetchRemoteTip(target);
  const parent = remoteTip || await quiet(git(target, ['rev-parse', '--verify', '--quiet', 'refs/heads/main']));
  await git(target, ['add', '--all', '--', '.']);
  const skipped = await dropLargeFiles(target, maxBytes);
  const tree = (await git(target, ['write-tree'])).trim();
  const parentTree = parent ? await quiet(git(target, ['rev-parse', `${parent}^{tree}`])) : '';
  let commit = parent;
  const changed = tree !== parentTree;
  if (changed) {
    const identity = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
    commit = (await git(target, ['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', message], identity)).trim();
  }
  await git(target, ['update-ref', 'refs/heads/main', commit]);
  if (commit !== remoteTip) {
    try { await git(target, ['push', '--quiet', 'origin', `${commit}:refs/heads/main`]); }
    catch (error) {
      if (/rejected|non-fast-forward|fetch first/i.test(String((error as Error).message))) {
        throw new Error('The project changed on GitHub while syncing. Sync again.');
      }
      throw error;
    }
  }
  const listing = await git(target, ['ls-tree', '-r', '-l', '-z', tree]);
  const entries = listing.split('\0').filter(Boolean);
  const bytes = entries.reduce((sum, line) => sum + (Number(line.split(/\s+/)[3]) || 0), 0);
  return { commit, changed, files: entries.length, bytes, skipped };
}

/** Fills an empty (or new) folder with the latest synced snapshot and links it to its private git dir. */
export async function restore(target: SyncTarget): Promise<void> {
  await fs.mkdir(target.root, { recursive: true });
  if ((await fs.readdir(target.root)).length) throw new Error(`${target.root} is not empty. Pick another folder.`);
  await ensureRepo(target);
  const tip = await fetchRemoteTip(target);
  if (!tip) throw new Error('This project has nothing synced yet.');
  await git(target, ['reset', '--quiet', '--hard', tip]);
}
