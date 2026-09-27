import { app, BrowserWindow, ipcMain, Menu, nativeImage, shell } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import * as workspace from './workspace';
import * as execution from './execution';
import * as agent from './agent';
import * as settings from './settings';
import * as git from './git';
import * as account from './account';
import * as cloud from './cloud';
import * as kernel from './kernel';
import * as computer from './computer';
import * as githubSync from './github';

function requireRoot(): string {
  const root = workspace.workspaceRoot();
  if (!root) throw new Error('Open a project folder first');
  return root;
}

// Apps opened from Finder get launchd's minimal PATH; borrow the login shell's so python3, git and gh resolve like in Terminal.
async function loadShellPath(): Promise<void> {
  if (!app.isPackaged || process.platform === 'win32') return;
  try {
    const { stdout } = await promisify(execFile)(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__KELUS_PATH__%s" "$PATH"'], { timeout: 8000 });
    const value = stdout.split('__KELUS_PATH__').at(-1)?.trim();
    if (value) process.env.PATH = value;
  } catch { /* keep the default PATH */ }
}

function createWindow(): void {
  const iconPath = path.join(app.getAppPath(), 'assets', 'icons', process.platform === 'win32' ? 'kelus.ico' : 'kelus.png');
  const win = new BrowserWindow({
    width: 1500, height: 950, minWidth: 900, minHeight: 600,
    backgroundColor: '#211b14', title: 'Kelus',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    icon: iconPath,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
  });
  win.loadFile(path.join(app.getAppPath(), 'dist-ui', 'index.html'));
}

app.whenReady().then(async () => {
  // Renamed here, not before ready: the Keychain entry that encrypts saved API keys is named after the startup name.
  app.setName('Kelus');
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'fileMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
  app.setAboutPanelOptions({
    applicationName: 'Kelus', applicationVersion: app.getVersion(), version: '',
    iconPath: path.join(app.getAppPath(), 'assets', 'icons', 'kelus.png')
  });
  await Promise.all([workspace.restoreWorkspace(), loadShellPath()]);
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'icons', 'kelus.png')));
  ipcMain.handle('workspace:open', async () => {
    const opened = await workspace.openWorkspace();
    if (opened) kernel.stopAll();
    return opened;
  });
  ipcMain.handle('agent:config', () => settings.agentConfig());
  ipcMain.handle('agent:config:update', (_e, value: unknown) => settings.updateAgentConfig(value));
  ipcMain.handle('computer:permissions', () => computer.computerPermissions());
  ipcMain.handle('computer:openPermission', (_e, kind: 'screen' | 'accessibility') => computer.openPermissionSettings(kind === 'screen' ? 'screen' : 'accessibility'));
  ipcMain.handle('computer:start', (event, task: string) => computer.startComputer(event.sender, task));
  ipcMain.handle('computer:decide', (_e, approved: boolean) => computer.decideComputer(approved === true));
  ipcMain.handle('computer:stop', () => computer.stopComputer());
  ipcMain.handle('kernel:interpreters', (_e, notebook: string) => kernel.listInterpreters(notebook));
  ipcMain.handle('kernel:start', (event, notebook: string, python?: string) => kernel.startKernel(event.sender, notebook, python));
  ipcMain.handle('kernel:execute', (_e, notebook: string, cell: string, code: string) => kernel.execute(notebook, cell, code));
  ipcMain.handle('kernel:interrupt', (_e, notebook: string) => kernel.interrupt(notebook));
  ipcMain.handle('kernel:restart', (_e, notebook: string) => kernel.restart(notebook));
  ipcMain.handle('kernel:shutdown', (_e, notebook: string) => kernel.shutdownKernel(notebook));
  ipcMain.handle('workspace:root', () => workspace.workspaceRoot());
  ipcMain.handle('workspace:list', (_e, relative: string) => workspace.listFiles(relative));
  ipcMain.handle('workspace:read', (_e, relative: string) => workspace.readFile(relative));
  ipcMain.handle('workspace:write', (_e, relative: string, content: string) => workspace.writeFile(relative, content));
  ipcMain.handle('workspace:create', (_e, relative: string, directory: boolean) => workspace.createEntry(relative, directory));
  ipcMain.handle('workspace:rename', (_e, from: string, to: string) => workspace.renameEntry(from, to));
  ipcMain.handle('workspace:delete', (_e, relative: string) => workspace.deleteEntry(relative));
  ipcMain.handle('terminal:start', (event, cols: number, rows: number) => execution.startTerminal(event.sender, workspace.workspaceRoot(), cols, rows));
  ipcMain.on('terminal:write', (_e, data: string) => execution.writeTerminal(data));
  ipcMain.on('terminal:resize', (_e, cols: number, rows: number) => execution.resizeTerminal(cols, rows));
  ipcMain.handle('agent:start', (event, task: string, command: string) => agent.startAgent(task, command, event.sender));
  ipcMain.handle('agent:decision', (_e, approved: boolean) => agent.agentDecision(approved));
  ipcMain.handle('settings:get', () => settings.publicSettings());
  ipcMain.handle('settings:update', (_e, value: settings.SettingsUpdate) => settings.updateSettings(value));
  ipcMain.handle('git:status', () => git.snapshot(requireRoot()));
  ipcMain.handle('git:init', () => git.init(requireRoot()));
  ipcMain.handle('git:origin', (_e, url: string) => git.setOrigin(requireRoot(), url));
  ipcMain.handle('git:commit', (_e, message: string, paths: string[]) => git.commit(requireRoot(), message, paths));
  ipcMain.handle('git:push', () => git.push(requireRoot()));
  ipcMain.handle('github:status', () => git.githubStatus());
  ipcMain.handle('github:download', () => shell.openExternal('https://cli.github.com/'));
  ipcMain.handle('account:current', () => account.currentAccount());
  ipcMain.handle('account:signUp', (_e, email: string, password: string, displayName: string) => account.signUp(email, password, displayName));
  ipcMain.handle('account:signIn', (_e, email: string, password: string) => account.signIn(email, password));
  ipcMain.handle('account:signOut', () => account.signOut());
  ipcMain.handle('account:signInWithBrowser', (_e, provider: string) => account.signInWithBrowser(provider === 'github' ? 'github' : 'google'));
  ipcMain.handle('account:cancelBrowser', () => account.cancelBrowserSignIn());
  ipcMain.handle('github:account', () => githubSync.githubAccount());
  ipcMain.handle('github:connect', (event) => githubSync.startGithubConnect(event.sender));
  ipcMain.handle('github:cancelConnect', () => githubSync.cancelGithubConnect());
  ipcMain.handle('github:disconnect', () => githubSync.disconnectGithub());
  ipcMain.handle('cloud:list', () => cloud.listProjects());
  ipcMain.handle('cloud:sync', (event) => cloud.syncProject(requireRoot(), progress => event.sender.send('sync:progress', progress)));
  ipcMain.handle('cloud:download', (_e, id: string) => cloud.downloadProject(id));
  ipcMain.handle('cloud:delete', (_e, id: string) => cloud.deleteProject(id));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { execution.stopTerminal(); agent.stopAgent(); kernel.stopAll(); computer.stopComputer(); });
