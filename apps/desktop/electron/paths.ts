import path from 'node:path';
import { app } from 'electron';

/** Files Python runs must live outside app.asar; packaged builds unpack agent-engine next to it. */
export function enginePath(file: string): string {
  return path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'agent-engine', file);
}
