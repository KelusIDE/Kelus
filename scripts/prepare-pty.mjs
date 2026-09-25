import { chmodSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'win32') {
  const helper = join(process.cwd(), 'node_modules', 'node-pty', 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  if (existsSync(helper)) {
    const mode = statSync(helper).mode;
    chmodSync(helper, mode | 0o111);
  }
}
