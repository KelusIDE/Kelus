import { dialog } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { readGitStatus } from './execution';
let root: string | null = null;
export type Entry = { name: string; path: string; directory: boolean; git?: string };

export function workspaceRoot(): string | null { return root; }
export async function openWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  root = await fs.realpath(result.filePaths[0]);
  return root;
}

async function guarded(relative: string, existing: boolean): Promise<string> {
  if (!root) throw new Error('Open a project folder first');
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid workspace path');
  const target = path.resolve(root, relative);
  if (target === root) throw new Error('Path must be inside the project folder');
  const check = await fs.realpath(existing ? target : path.dirname(target));
  if (check !== root && !check.startsWith(root + path.sep)) throw new Error('Path escapes the project folder');
  if (!existing) {
    try {
      const actual = await fs.realpath(target);
      if (actual !== root && !actual.startsWith(root + path.sep)) throw new Error('Path escapes the project folder');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export async function listFiles(relative = ''): Promise<Entry[]> {
  if (!root) return [];
  const directory = relative ? await guarded(relative, true) : root;
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const status = relative ? new Map<string, string>() : await readGitStatus(root);
  return entries.filter(e => e.name !== '.git')
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .map(e => ({ name: e.name, path: path.join(relative, e.name).split(path.sep).join('/'), directory: e.isDirectory(), git: status.get(e.name) }));
}

export async function readFile(relative: string): Promise<string> { return fs.readFile(await guarded(relative, true), 'utf8'); }
export async function writeFile(relative: string, content: string): Promise<void> {
  const target = await guarded(relative, false);
  await fs.writeFile(target, content, 'utf8');
}
export async function createEntry(relative: string, directory: boolean): Promise<void> {
  const target = await guarded(relative, false);
  if (directory) await fs.mkdir(target); else await fs.writeFile(target, '', { flag: 'wx' });
}
export async function renameEntry(from: string, to: string): Promise<void> {
  const destination = await guarded(to, false);
  try { await fs.lstat(destination); throw new Error('Destination already exists'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await fs.rename(await guarded(from, true), destination);
}
export async function deleteEntry(relative: string): Promise<void> {
  const target = await guarded(relative, true);
  await fs.rm(target, { recursive: true });
}
