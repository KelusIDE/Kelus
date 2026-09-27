import path from 'node:path';
import { app } from 'electron';

/** Python on PATH: Windows installs `python`; `python3` there is often the Microsoft Store stub. */
export function defaultPython(): string {
  return process.env.KELUS_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
}

/** Files Python runs must live outside app.asar; packaged builds unpack agent-engine next to it. */
export function enginePath(file: string): string {
  return path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'agent-engine', file);
}
