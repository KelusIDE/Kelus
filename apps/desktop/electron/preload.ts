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
  onAgentEvent: (callback: (event: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, event: unknown) => callback(event);
    ipcRenderer.on('agent:event', listener);
    return () => ipcRenderer.removeListener('agent:event', listener);
  }
});
