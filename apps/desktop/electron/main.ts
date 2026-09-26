import { app, BrowserWindow, ipcMain, nativeImage, shell } from 'electron';
import path from 'node:path';
import * as workspace from './workspace';
import * as execution from './execution';
import * as agent from './agent';
import * as settings from './settings';
import * as git from './git';
import * as account from './account';
import * as cloud from './cloud';

function requireRoot(): string {
  const root = workspace.workspaceRoot();
  if (!root) throw new Error('Open a project folder first');
  return root;
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
  win.loadFile(path.join(app.getAppPath(), 'dist-ui', 'index.html'));
}

app.whenReady().then(() => {
  app.setName('Kelus');
  if (process.platform === 'darwin') app.dock?.setIcon(nativeImage.createFromPath(path.join(app.getAppPath(), 'assets', 'icons', 'kelus.png')));
  ipcMain.handle('workspace:open', () => workspace.openWorkspace());
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
  ipcMain.handle('cloud:list', () => cloud.listProjects());
  ipcMain.handle('cloud:sync', (event) => cloud.syncProject(requireRoot(), progress => event.sender.send('sync:progress', progress)));
  ipcMain.handle('cloud:download', (_e, id: string) => cloud.downloadProject(id));
  ipcMain.handle('cloud:delete', (_e, id: string) => cloud.deleteProject(id));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { execution.stopTerminal(); agent.stopAgent(); });
