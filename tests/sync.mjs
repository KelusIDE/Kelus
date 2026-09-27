import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const sync = require('../dist-electron/syncGit.js');
const base = mkdtempSync(path.join(tmpdir(), 'kelus-sync-'));
const remote = path.join(base, 'remote.git');
execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
const author = { name: 'kelus-test', email: 'test@example.com' };
const commits = () => execFileSync('git', ['--git-dir', remote, 'rev-list', '--count', 'main']).toString().trim();
const remoteFiles = () => execFileSync('git', ['--git-dir', remote, 'ls-tree', '-r', '--name-only', 'main']).toString().trim().split('\n').sort();

try {
  // Machine A: a project that is itself a git repo, with secrets, deps and a too-big file.
  const a = path.join(base, 'project-a');
  mkdirSync(path.join(a, 'src'), { recursive: true }); mkdirSync(path.join(a, 'node_modules', 'x'), { recursive: true });
  execFileSync('git', ['init', '--quiet', a]);
  writeFileSync(path.join(a, 'src', 'main.py'), 'print("hi")\n');
  writeFileSync(path.join(a, '.env'), 'SECRET=1\n'); writeFileSync(path.join(a, '.env.example'), 'SECRET=\n');
  writeFileSync(path.join(a, 'node_modules', 'x', 'index.js'), '');
  writeFileSync(path.join(a, '.gitignore'), 'logs/\n'); mkdirSync(path.join(a, 'logs')); writeFileSync(path.join(a, 'logs', 'a.log'), 'x');
  writeFileSync(path.join(a, 'big.bin'), Buffer.alloc(2048));
  const targetA = { root: a, gitDir: path.join(base, 'sync', 'a.git'), remote };
  const first = await sync.snapshotAndPush(targetA, author, 'sync 1', 1024);
  assert.equal(first.changed, true);
  assert.deepEqual(first.skipped, ['big.bin']);
  assert.deepEqual(remoteFiles(), ['.env.example', '.gitignore', 'src/main.py']);
  assert.equal(commits(), '1');
  assert.equal(execFileSync('git', ['-C', a, 'ls-files']).toString(), '', "the project's own git index is untouched");

  const again = await sync.snapshotAndPush(targetA, author, 'sync 2', 1024);
  assert.equal(again.changed, false); assert.equal(commits(), '1');

  // Machine B downloads, edits and syncs; machine A then syncs on top without a rejected push.
  const b = path.join(base, 'download', 'project-a');
  const targetB = { root: b, gitDir: path.join(base, 'sync', 'b.git'), remote };
  await sync.restore(targetB);
  assert.equal(readFileSync(path.join(b, 'src', 'main.py'), 'utf8'), 'print("hi")\n');
  assert.equal(existsSync(path.join(b, '.git')), false, 'download stays a plain folder');
  writeFileSync(path.join(b, 'src', 'extra.py'), 'x = 1\n');
  await sync.snapshotAndPush(targetB, author, 'sync from B');
  assert.equal(commits(), '2');
  writeFileSync(path.join(a, 'src', 'main.py'), 'print("hi again")\n');
  const fromA = await sync.snapshotAndPush(targetA, author, 'sync 3 from A', 1024);
  assert.equal(fromA.changed, true); assert.equal(commits(), '3');
  assert.deepEqual(remoteFiles(), ['.env.example', '.gitignore', 'src/main.py'], 'latest sync wins: A never had extra.py');

  await assert.rejects(sync.restore(targetB), /not empty/);
  console.log('GitHub sync core: OK');
} finally { rmSync(base, { recursive: true, force: true }); }
