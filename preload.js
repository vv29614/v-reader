'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isElectron: true,
  version: process.versions.electron,
  platform: process.platform,
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  reveal: (p) => ipcRenderer.invoke('shell:reveal', p),
  togglePin: () => ipcRenderer.invoke('win:togglePin'),
  associate: () => ipcRenderer.invoke('app:associate'),
  onOpenPaths: (cb) => ipcRenderer.on('app:open-paths', (_e, paths) => cb(paths)),
  openWindow: (bookId, at) => ipcRenderer.invoke('win:openBook', bookId, at),
  onAction: (cb) => ipcRenderer.on('app:action', (_e, action) => cb(action))
});
