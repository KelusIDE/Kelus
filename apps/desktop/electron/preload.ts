import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('kelus', {
  platform: process.platform,
  openWorkspace: () => ipcRenderer.invoke('workspace:open'),
  getRoot: () => ipcRenderer.invoke('workspace:root'),
  listFiles: (path = '') => ipcRenderer.invoke('workspace:list', path),
  readFile: (path: string) => ipcRenderer.invoke('workspace:read', path),
  writeFile: (path: string, content: string) => ipcRenderer.invoke('workspace:write', path, content),
  createEntry: (path: string, directory: boolean) => ipcRenderer.invoke('workspace:create', path, directory),
  renameEntry: (from: string, to: string) => ipcRenderer.invoke('workspace:rename', from, to),
  deleteEntry: (path: string) => ipcRenderer.invoke('workspace:delete', path),
  startTerminal: (cols: number, rows: number) => ipcRenderer.invoke('terminal:start', cols, rows),
  writeTerminal: (data: string) => ipcRenderer.send('terminal:write', data),
  resizeTerminal: (cols: number, rows: number) => ipcRenderer.send('terminal:resize', cols, rows),
  onTerminalData: (callback: (data: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: string) => callback(data);
    ipcRenderer.on('terminal:data', listener);
    return () => ipcRenderer.removeListener('terminal:data', listener);
  },
  startTask: (task: string, testCommand: string) => ipcRenderer.invoke('agent:start', task, testCommand),
  decide: (approved: boolean) => ipcRenderer.invoke('agent:decision', approved),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (value: unknown) => ipcRenderer.invoke('settings:update', value),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitInit: () => ipcRenderer.invoke('git:init'),
  gitSetOrigin: (url: string) => ipcRenderer.invoke('git:origin', url),
  gitCommit: (message: string, paths: string[]) => ipcRenderer.invoke('git:commit', message, paths),
  gitPush: () => ipcRenderer.invoke('git:push'),
  githubStatus: () => ipcRenderer.invoke('github:status'),
  githubDownload: () => ipcRenderer.invoke('github:download'),
  onAgentEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  },
  accountCurrent: () => ipcRenderer.invoke('account:current'),
  accountSignUp: (email: string, password: string, displayName: string) => ipcRenderer.invoke('account:signUp', email, password, displayName),
  accountSignIn: (email: string, password: string) => ipcRenderer.invoke('account:signIn', email, password),
  accountSignOut: () => ipcRenderer.invoke('account:signOut'),
  cloudList: () => ipcRenderer.invoke('cloud:list'),
  cloudSync: () => ipcRenderer.invoke('cloud:sync'),
  cloudDownload: (projectId: string) => ipcRenderer.invoke('cloud:download', projectId),
  cloudDelete: (projectId: string) => ipcRenderer.invoke('cloud:delete', projectId),
  onSyncProgress: (callback: (progress: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: unknown) => callback(progress);
    ipcRenderer.on('sync:progress', listener);
    return () => ipcRenderer.removeListener('sync:progress', listener);
  }
});
