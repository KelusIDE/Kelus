import { app, BrowserWindow, ipcMain, nativeImage } from 'electron';
import path from 'node:path';
import * as workspace from './workspace';
import * as execution from './execution';
import * as agent from './agent';

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
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { execution.stopTerminal(); agent.stopAgent(); });
