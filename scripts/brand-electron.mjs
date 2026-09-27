// Dev-only: show "Kelus" and the Kelus icon in the macOS menu bar, Dock and About panel.
// Packaged builds get this from the app bundle; `electron .` otherwise runs as "Electron".
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform === 'darwin') {
  const bundle = join(process.cwd(), 'node_modules', 'electron', 'dist', 'Electron.app');
  const plist = join(bundle, 'Contents', 'Info.plist');
  const icon = join(process.cwd(), 'assets', 'icons', 'kelus.icns');
  if (existsSync(plist)) {
    try {
      for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        execFileSync('/usr/libexec/PlistBuddy', ['-c', `Set :${key} Kelus`, plist]);
      }
      if (existsSync(icon)) copyFileSync(icon, join(bundle, 'Contents', 'Resources', 'electron.icns'));
      // Editing Info.plist breaks the ad-hoc seal; re-sign only the outer bundle.
      execFileSync('codesign', ['--force', '--sign', '-', bundle], { stdio: 'ignore' });
    } catch (error) {
      console.warn(`[brand-electron] skipped: ${error.message}`);
    }
  }
}
