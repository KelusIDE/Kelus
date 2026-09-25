import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import * as pty from 'node-pty';

const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : (process.env.SHELL || '/bin/sh');
const terminal = pty.spawn(shell, [], {
  name: 'xterm-256color', cols: 80, rows: 24, cwd: tmpdir(), env: process.env
});

try {
  await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`PTY command produced no result: ${output}`)), 10000);
    terminal.onData(data => {
      output += data;
      if (/\r?\nKELUS_PTY_OK\r?\n/.test(output)) {
        clearTimeout(timeout);
        resolve();
      }
    });
    terminal.onExit(({ exitCode }) => {
      clearTimeout(timeout);
      reject(new Error(`PTY exited before command completed: ${exitCode}`));
    });
    terminal.write('echo KELUS_PTY_OK\r');
  });
  assert.ok(true);
  process.stdout.write('PTY command execution: OK\n');
} finally {
  terminal.kill();
}
