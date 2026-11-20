import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type OptibenchAPI } from './ipc';

function on<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const h = (_e: IpcRendererEvent, ...args: unknown[]): void => cb(...(args as T));
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
}

const api: OptibenchAPI = {
  platform: process.platform,
  rendererReady: () => ipcRenderer.invoke(IPC.rendererReady),
  openDialog: () => ipcRenderer.invoke(IPC.openDialog),
  saveDialog: (name) => ipcRenderer.invoke(IPC.saveDialog, name),
  readFile: (p) => ipcRenderer.invoke(IPC.readFile, p),
  writeFile: (p, t) => ipcRenderer.invoke(IPC.writeFile, p, t),
  openPath: (p) => ipcRenderer.invoke(IPC.openPath, p),
  getRecent: () => ipcRenderer.invoke(IPC.getRecent),
  addRecent: (p) => ipcRenderer.invoke(IPC.addRecent, p),
  removeRecent: (p) => ipcRenderer.invoke(IPC.removeRecent, p),
  clearRecent: () => ipcRenderer.invoke(IPC.clearRecent),
  listExamples: () => ipcRenderer.invoke(IPC.listExamples),
  confirmUnsaved: (t) => ipcRenderer.invoke(IPC.confirmUnsaved, t),
  setTitle: (t, d) => ipcRenderer.invoke(IPC.setTitle, t, d),
  setRepresentedFile: (p) => ipcRenderer.invoke(IPC.setRepresentedFile, p),
  exportPng: (data, name) => ipcRenderer.invoke(IPC.exportPng, data, name),
  openExternal: (u) => ipcRenderer.invoke(IPC.openExternal, u),
  showItemInFolder: (p) => ipcRenderer.invoke(IPC.showItemInFolder, p),
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  windowControl: (a) => ipcRenderer.invoke(IPC.windowControl, a),
  isMaximized: () => ipcRenderer.invoke(IPC.isMaximized),
  closeConfirmed: () => ipcRenderer.invoke(IPC.closeConfirmed),
  quit: () => ipcRenderer.invoke(IPC.quit),
  getLibrary: () => ipcRenderer.invoke(IPC.libraryGet),
  saveLibraryItem: (item) => ipcRenderer.invoke(IPC.librarySave, item),
  deleteLibraryItem: (id) => ipcRenderer.invoke(IPC.libraryDelete, id),
  renameLibraryItem: (id, patch) => ipcRenderer.invoke(IPC.libraryRename, id, patch),
  importLibraryDialog: () => ipcRenderer.invoke(IPC.libraryImportDialog),
  exportTextDialog: (text, name, kind) => ipcRenderer.invoke(IPC.exportTextDialog, text, name, kind),
  onFileOpened: (cb) => on(IPC.fileOpened, cb),
  onCloseRequested: (cb) => on(IPC.closeRequested, cb),
  onMaximizeChanged: (cb) => on(IPC.maximizeChanged, cb)
};

contextBridge.exposeInMainWorld('optibench', api);
