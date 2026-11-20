/** IPC channel names + payload types shared by main, preload and renderer (no runtime deps). */

export const IPC = {
  rendererReady: 'obw:renderer-ready',
  openDialog: 'obw:open-dialog',
  saveDialog: 'obw:save-dialog',
  readFile: 'obw:read-file',
  writeFile: 'obw:write-file',
  openPath: 'obw:open-path',
  getRecent: 'obw:recent-get',
  addRecent: 'obw:recent-add',
  removeRecent: 'obw:recent-remove',
  clearRecent: 'obw:recent-clear',
  listExamples: 'obw:examples-list',
  confirmUnsaved: 'obw:confirm-unsaved',
  setTitle: 'obw:set-title',
  setRepresentedFile: 'obw:set-represented-file',
  exportPng: 'obw:export-png',
  openExternal: 'obw:open-external',
  showItemInFolder: 'obw:show-item-in-folder',
  appInfo: 'obw:app-info',
  windowControl: 'obw:window-control',
  isMaximized: 'obw:is-maximized',
  closeConfirmed: 'obw:close-confirmed',
  quit: 'obw:quit',
  libraryGet: 'obw:library-get',
  librarySave: 'obw:library-save',
  libraryDelete: 'obw:library-delete',
  libraryRename: 'obw:library-rename',
  libraryImportDialog: 'obw:library-import-dialog',
  exportTextDialog: 'obw:export-text-dialog',
  // main -> renderer events
  fileOpened: 'obw:file-opened',
  closeRequested: 'obw:close-requested',
  maximizeChanged: 'obw:maximize-changed'
} as const;

export interface OpenedFile { path: string; text: string }
export interface RecentEntry { path: string; exists: boolean }
export interface ExampleEntry { path: string; file: string; title: string; description: string }
export type UnsavedChoice = 'save' | 'discard' | 'cancel';
export type WindowAction =
  | 'minimize' | 'maximize' | 'close' | 'toggleFullscreen' | 'toggleDevTools' | 'reload'
  | 'zoomIn' | 'zoomOut' | 'zoomReset';
/** Text formats that may be written — always to a path the user picked in a save dialog. */
export type TextExportKind = 'csv' | 'json' | 'obwlib';
export interface LibraryPatch { name?: string; category?: string; description?: string }

export interface AppInfo { version: string; electron: string; chrome: string; node: string; platform: string }

/** The API exposed on `window.optibench`. */
export interface OptibenchAPI {
  platform: 'win32' | 'darwin' | 'linux' | string;
  /** Call once when the UI is mounted; resolves with a file passed on the command line / via Finder, if any. */
  rendererReady(): Promise<OpenedFile | null>;
  openDialog(): Promise<OpenedFile | null>;
  saveDialog(defaultName?: string): Promise<string | null>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, text: string): Promise<void>;
  /** Read a known path (recent / example) and add it to recents. */
  openPath(path: string): Promise<OpenedFile | null>;
  getRecent(): Promise<RecentEntry[]>;
  addRecent(path: string): Promise<string[]>;
  removeRecent(path: string): Promise<string[]>;
  clearRecent(): Promise<string[]>;
  listExamples(): Promise<ExampleEntry[]>;
  confirmUnsaved(title: string): Promise<UnsavedChoice>;
  setTitle(title: string, dirty: boolean): Promise<void>;
  setRepresentedFile(path: string | null): Promise<void>;
  /** Shows a save dialog and writes the PNG bytes. Resolves with the path or null if cancelled. */
  exportPng(data: Uint8Array, defaultName?: string): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  showItemInFolder(path: string): Promise<void>;
  appInfo(): Promise<AppInfo>;
  windowControl(action: WindowAction): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  /** Tell main the renderer has resolved unsaved changes; closes the window. */
  closeConfirmed(): Promise<void>;
  quit(): Promise<void>;
  // --- component library (userData/library.json). Items are validated LibraryItem objects.
  getLibrary(): Promise<unknown[]>;
  saveLibraryItem(item: unknown): Promise<void>;
  deleteLibraryItem(id: string): Promise<void>;
  renameLibraryItem(id: string, patch: LibraryPatch): Promise<void>;
  /** Open dialog for .obwlib files; resolves with the chosen files' text, or null if cancelled. */
  importLibraryDialog(): Promise<OpenedFile[] | null>;
  /** Save dialog + write (csv / json / obwlib only). Resolves with the written path or null if cancelled. */
  exportTextDialog(text: string, defaultName: string, kind: TextExportKind): Promise<string | null>;
  onFileOpened(cb: (f: OpenedFile) => void): () => void;
  onCloseRequested(cb: () => void): () => void;
  onMaximizeChanged(cb: (maximized: boolean) => void): () => void;
}
