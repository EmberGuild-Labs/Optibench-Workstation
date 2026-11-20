/**
 * Optibench Workstation — Electron main process.
 * Window management, file association, dialogs and file I/O over IPC.
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen, shell, type IpcMainInvokeEvent } from 'electron';
import { join, extname, basename } from 'path';
import { promises as fs, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { APP_NAME, APP_VERSION, FILE_EXTENSION } from '../core/types';
import { IPC, type ExampleEntry, type UnsavedChoice, type OpenedFile, type LibraryPatch, type TextExportKind } from '../preload/ipc';
import { validateLibraryItem, type LibraryItem, LIBRARY_EXTENSION } from '../core/project/library';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const BG = '#d4d0c8';
const MAX_RECENT = 10;

let mainWindow: BrowserWindow | null = null;
let pendingFile: string | null = null;
let rendererReady = false;
let docDirty = false;
let closeConfirmed = false;

// ---------------------------------------------------------------------------
// Single instance
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setName(APP_NAME);
if (isWin) app.setAppUserModelId('com.optibench.workstation');
nativeTheme.themeSource = 'light';

function fileFromArgv(argv: string[]): string | null {
  // Skip electron binary / script path; pick the first existing .obw argument.
  for (const a of argv.slice(1)) {
    if (a.startsWith('-')) continue;
    if (extname(a).toLowerCase() === `.${FILE_EXTENSION}` && existsSync(a)) return a;
  }
  return null;
}

pendingFile = fileFromArgv(process.argv);

app.on('second-instance', (_e, argv) => {
  const f = fileFromArgv(argv);
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (f) deliverFile(f);
});

// macOS: Finder double-click / dock drop (may fire before ready)
app.on('open-file', (event, path) => {
  event.preventDefault();
  if (!isMac) return;
  deliverFile(path);
});

function deliverFile(path: string): void {
  if (mainWindow && rendererReady) {
    void readOpened(path).then((f) => { if (f) mainWindow?.webContents.send(IPC.fileOpened, f); });
  } else {
    pendingFile = path;
  }
}

// ---------------------------------------------------------------------------
// Persistent state (window bounds, recent files)
// ---------------------------------------------------------------------------

interface WindowState { x?: number; y?: number; width: number; height: number; maximized: boolean }

const userPath = (name: string): string => join(app.getPath('userData'), name);

function readJson<T>(name: string, def: T): T {
  try {
    return JSON.parse(readFileSync(userPath(name), 'utf8')) as T;
  } catch {
    return def;
  }
}

function writeJson(name: string, data: unknown): void {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true });
    writeFileSync(userPath(name), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write', name, e);
  }
}

function loadWindowState(): WindowState {
  const s = readJson<WindowState>('window-state.json', { width: 1440, height: 900, maximized: false });
  const w = Math.max(1024, Number(s.width) || 1440);
  const h = Math.max(640, Number(s.height) || 900);
  if (typeof s.x === 'number' && typeof s.y === 'number') {
    const visible = screen.getAllDisplays().some((d) => {
      const b = d.workArea;
      return s.x! + 100 > b.x && s.x! < b.x + b.width - 100 && s.y! >= b.y - 10 && s.y! < b.y + b.height - 60;
    });
    if (visible) return { x: s.x, y: s.y, width: w, height: h, maximized: !!s.maximized };
  }
  return { width: w, height: h, maximized: !!s.maximized };
}

function saveWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  const maximized = win.isMaximized();
  const b = maximized ? win.getNormalBounds() : win.getBounds();
  writeJson('window-state.json', { x: b.x, y: b.y, width: b.width, height: b.height, maximized });
}

function getRecent(): string[] {
  const list = readJson<unknown>('recent-files.json', []);
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string').slice(0, MAX_RECENT) : [];
}

function addRecent(path: string): string[] {
  const norm = (p: string): string => (isWin ? p.toLowerCase() : p);
  const list = [path, ...getRecent().filter((p) => norm(p) !== norm(path))].slice(0, MAX_RECENT);
  writeJson('recent-files.json', list);
  try { app.addRecentDocument(path); } catch { /* not supported on this platform */ }
  return list;
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const st = loadWindowState();
  const iconPath = join(app.getAppPath(), 'build', isWin ? 'icon.ico' : 'icon.png');

  const win = new BrowserWindow({
    x: st.x,
    y: st.y,
    width: st.width,
    height: st.height,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: BG,
    title: APP_NAME,
    icon: existsSync(iconPath) ? iconPath : undefined,
    // Windows/Linux: frameless, caption buttons drawn in HTML (classic theme). macOS: native traffic lights.
    ...(isMac ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 10, y: 4 } } : { frame: false }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  });
  mainWindow = win;
  if (st.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());

  let saveTimer: NodeJS.Timeout | null = null;
  const scheduleSave = (): void => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', () => win.webContents.send(IPC.maximizeChanged, true));
  win.on('unmaximize', () => win.webContents.send(IPC.maximizeChanged, false));

  win.on('close', (e) => {
    saveWindowState(win);
    if (docDirty && !closeConfirmed && rendererReady) {
      e.preventDefault();
      win.webContents.send(IPC.closeRequested);
    }
  });
  win.on('closed', () => {
    mainWindow = null;
    rendererReady = false;
  });

  // Security: no navigation, no new windows. External links go through openExternal (https only).
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL'];
    if (devUrl && url.startsWith(devUrl)) return; // HMR full reload
    e.preventDefault();
  });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  if (!app.isPackaged) {
    // surface renderer warnings/errors in the dev terminal
    win.webContents.on('console-message', (ev) => {
      const e = ev as unknown as { level?: string | number; message?: string; sourceId?: string; lineNumber?: number };
      const lvl = String(e.level);
      if (lvl === 'warning' || lvl === 'error' || lvl === '2' || lvl === '3') console.log(`[renderer:${lvl}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
    });
    win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer gone]', d.reason));
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (!app.isPackaged && devUrl) void win.loadURL(devUrl);
  // `--obw-qa` (unpackaged builds only) exposes the window.__obw automation handle in the renderer.
  else void win.loadFile(join(__dirname, '../renderer/index.html'), !app.isPackaged && process.argv.includes('--obw-qa') ? { query: { qa: '1' } } : undefined);
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

const OBW_FILTERS = [
  { name: 'Optibench Project', extensions: [FILE_EXTENSION] },
  { name: 'All Files', extensions: ['*'] }
];

function isObwPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && extname(p).toLowerCase() === `.${FILE_EXTENSION}`;
}

async function readOpened(path: string): Promise<OpenedFile | null> {
  try {
    const text = await fs.readFile(path, 'utf8');
    addRecent(path);
    return { path, text };
  } catch (e) {
    dialog.showErrorBox('Could not open file', `${path}\n\n${(e as Error).message}`);
    return null;
  }
}

function winOf(e: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(e.sender) ?? undefined;
}

function examplesDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'examples') : join(app.getAppPath(), 'examples');
}

function registerIpc(): void {
  ipcMain.handle(IPC.rendererReady, () => {
    rendererReady = true;
    const f = pendingFile;
    pendingFile = null;
    return f ? readOpened(f) : null;
  });

  ipcMain.handle(IPC.openDialog, async (e): Promise<OpenedFile | null> => {
    const w = winOf(e);
    const opts = { title: 'Open Project', filters: OBW_FILTERS, properties: ['openFile' as const] };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths[0]) return null;
    return readOpened(r.filePaths[0]);
  });

  ipcMain.handle(IPC.saveDialog, async (e, defaultName: unknown): Promise<string | null> => {
    const w = winOf(e);
    let name = typeof defaultName === 'string' && defaultName ? defaultName : 'Untitled';
    if (!name.toLowerCase().endsWith(`.${FILE_EXTENSION}`)) name += `.${FILE_EXTENSION}`;
    const opts = { title: 'Save Project', defaultPath: join(app.getPath('documents'), basename(name)), filters: OBW_FILTERS.slice(0, 1) };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    let p: string = r.filePath;
    if (extname(p).toLowerCase() !== `.${FILE_EXTENSION}`) p += `.${FILE_EXTENSION}`;
    return p;
  });

  ipcMain.handle(IPC.readFile, async (_e, path: unknown): Promise<string> => {
    if (!isObwPath(path)) throw new Error('Only .obw project files can be read.');
    return fs.readFile(path, 'utf8');
  });

  ipcMain.handle(IPC.writeFile, async (_e, path: unknown, text: unknown): Promise<void> => {
    if (!isObwPath(path)) throw new Error('Only .obw project files can be written.');
    if (typeof text !== 'string') throw new Error('Invalid file contents.');
    const tmp = `${path}.tmp-${process.pid}`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, path);
    addRecent(path);
  });

  ipcMain.handle(IPC.openPath, async (_e, path: unknown): Promise<OpenedFile | null> => {
    if (!isObwPath(path)) throw new Error('Only .obw project files can be opened.');
    return readOpened(path);
  });

  ipcMain.handle(IPC.getRecent, () => getRecent().map((path) => ({ path, exists: existsSync(path) })));
  ipcMain.handle(IPC.addRecent, (_e, path: unknown) => (isObwPath(path) ? addRecent(path) : getRecent()));
  ipcMain.handle(IPC.removeRecent, (_e, path: unknown) => {
    const list = getRecent().filter((p) => p !== path);
    writeJson('recent-files.json', list);
    return list;
  });
  ipcMain.handle(IPC.clearRecent, () => {
    writeJson('recent-files.json', []);
    try { app.clearRecentDocuments(); } catch { /* ignore */ }
    return [];
  });

  ipcMain.handle(IPC.listExamples, async (): Promise<ExampleEntry[]> => {
    const dir = examplesDir();
    let files: string[] = [];
    try {
      files = (await fs.readdir(dir)).filter((f) => isObwPath(f)).sort();
    } catch {
      return [];
    }
    const out: ExampleEntry[] = [];
    for (const f of files) {
      const path = join(dir, f);
      let title = f.replace(/\.obw$/i, '');
      let description = '';
      try {
        const j = JSON.parse(await fs.readFile(path, 'utf8')) as { meta?: { title?: unknown; description?: unknown } };
        if (typeof j.meta?.title === 'string') title = j.meta.title;
        if (typeof j.meta?.description === 'string') description = j.meta.description;
      } catch { /* list anyway */ }
      out.push({ path, file: f, title, description });
    }
    return out;
  });

  ipcMain.handle(IPC.confirmUnsaved, async (e, title: unknown): Promise<UnsavedChoice> => {
    const w = winOf(e);
    const name = typeof title === 'string' && title ? title : 'Untitled';
    const opts = {
      type: 'warning' as const,
      title: APP_NAME,
      message: `Save changes to "${name}"?`,
      detail: 'Your changes will be lost if you don’t save them.',
      buttons: ['Save', 'Don’t Save', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      noLink: true
    };
    const r = w ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    return r.response === 0 ? 'save' : r.response === 1 ? 'discard' : 'cancel';
  });

  ipcMain.handle(IPC.setTitle, (e, title: unknown, dirty: unknown) => {
    const w = winOf(e);
    docDirty = dirty === true;
    if (!w) return;
    const t = typeof title === 'string' && title ? `${docDirty ? '● ' : ''}${title} — ${APP_NAME}` : APP_NAME;
    w.setTitle(t);
    if (isMac) w.setDocumentEdited(docDirty);
  });

  ipcMain.handle(IPC.setRepresentedFile, (e, path: unknown) => {
    const w = winOf(e);
    if (w && isMac) w.setRepresentedFilename(typeof path === 'string' ? path : '');
  });

  ipcMain.handle(IPC.exportPng, async (e, data: unknown, defaultName: unknown): Promise<string | null> => {
    if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) throw new Error('Invalid image data.');
    const w = winOf(e);
    let name = typeof defaultName === 'string' && defaultName ? basename(defaultName) : 'viewport.png';
    if (!name.toLowerCase().endsWith('.png')) name += '.png';
    const opts = { title: 'Export PNG', defaultPath: join(app.getPath('pictures'), name), filters: [{ name: 'PNG Image', extensions: ['png'] }] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    let p = r.filePath;
    if (extname(p).toLowerCase() !== '.png') p += '.png';
    await fs.writeFile(p, Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data));
    return p;
  });

  // ---- component library (userData/library.json)
  const LIB_FILE = 'library.json';
  const MAX_LIB_ITEMS = 500;
  const MAX_ITEM_BYTES = 2_000_000;
  const readLibrary = (): LibraryItem[] => {
    const raw = readJson<unknown>(LIB_FILE, { items: [] });
    const list = raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
    const out: LibraryItem[] = [];
    for (const it of list) {
      try { out.push(validateLibraryItem(it)); } catch { /* skip corrupt entries */ }
    }
    return out;
  };
  const writeLibrary = (items: LibraryItem[]): void => writeJson(LIB_FILE, { format: 'optibench-library', version: 1, items });
  ipcMain.handle(IPC.libraryGet, () => readLibrary());
  ipcMain.handle(IPC.librarySave, (_e, item: unknown) => {
    if (JSON.stringify(item ?? null).length > MAX_ITEM_BYTES) throw new Error('Library item is too large.');
    const v = validateLibraryItem(item);
    const { builtin: _b, ...clean } = v;
    const items = readLibrary().filter((x) => x.id !== clean.id);
    if (items.length >= MAX_LIB_ITEMS) throw new Error(`The library is full (${MAX_LIB_ITEMS} items).`);
    items.push({ ...clean, modified: new Date().toISOString() });
    writeLibrary(items);
  });
  ipcMain.handle(IPC.libraryDelete, (_e, id: unknown) => {
    if (typeof id !== 'string') return;
    writeLibrary(readLibrary().filter((x) => x.id !== id));
  });
  ipcMain.handle(IPC.libraryRename, (_e, id: unknown, patch: unknown) => {
    if (typeof id !== 'string' || !patch || typeof patch !== 'object') return;
    const p = patch as LibraryPatch;
    const items = readLibrary().map((x) => {
      if (x.id !== id) return x;
      const next = { ...x, modified: new Date().toISOString() };
      if (typeof p.name === 'string' && p.name.trim()) next.name = p.name.trim().slice(0, 120);
      if (typeof p.category === 'string') next.category = p.category.trim().slice(0, 60) || 'General';
      if (typeof p.description === 'string') next.description = p.description.slice(0, 2000);
      return next;
    });
    writeLibrary(items);
  });
  ipcMain.handle(IPC.libraryImportDialog, async (e): Promise<OpenedFile[] | null> => {
    const w = winOf(e);
    const opts = {
      title: 'Import Library Items',
      filters: [{ name: 'Optibench Library', extensions: [LIBRARY_EXTENSION] }, { name: 'All Files', extensions: ['*'] }],
      properties: ['openFile' as const, 'multiSelections' as const]
    };
    const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts);
    if (r.canceled || !r.filePaths.length) return null;
    const out: OpenedFile[] = [];
    for (const path of r.filePaths) {
      const st = await fs.stat(path);
      if (st.size > 20_000_000) throw new Error(`${basename(path)} is too large.`);
      out.push({ path, text: await fs.readFile(path, 'utf8') });
    }
    return out;
  });
  // Text export (.csv / .json / .obwlib): only ever written to the path the user picks in the dialog.
  const TEXT_KINDS: Record<TextExportKind, { name: string; title: string }> = {
    csv: { name: 'CSV (Comma delimited)', title: 'Export CSV' },
    json: { name: 'JSON', title: 'Export JSON' },
    obwlib: { name: 'Optibench Library', title: 'Export Library Item' }
  };
  ipcMain.handle(IPC.exportTextDialog, async (e, text: unknown, defaultName: unknown, kind: unknown): Promise<string | null> => {
    if (typeof text !== 'string') throw new Error('Invalid file contents.');
    if (typeof kind !== 'string' || !(kind in TEXT_KINDS)) throw new Error('Unsupported export type.');
    const k = kind as TextExportKind;
    const w = winOf(e);
    let name = typeof defaultName === 'string' && defaultName ? basename(defaultName).replace(/[<>:"/\\|?*]/g, '_') : 'export';
    if (extname(name).toLowerCase() !== `.${k}`) name += `.${k}`;
    const opts = { title: TEXT_KINDS[k].title, defaultPath: join(app.getPath('documents'), name), filters: [{ name: TEXT_KINDS[k].name, extensions: [k] }] };
    const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts);
    if (r.canceled || !r.filePath) return null;
    let p = r.filePath;
    if (extname(p).toLowerCase() !== `.${k}`) p += `.${k}`;
    await fs.writeFile(p, text, 'utf8');
    return p;
  });

  ipcMain.handle(IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string') return false;
    let u: URL;
    try { u = new URL(url); } catch { return false; }
    if (u.protocol !== 'https:') return false;
    await shell.openExternal(u.toString());
    return true;
  });

  ipcMain.handle(IPC.showItemInFolder, (_e, path: unknown) => {
    if (isObwPath(path) || (typeof path === 'string' && extname(path).toLowerCase() === '.png')) shell.showItemInFolder(path);
  });

  ipcMain.handle(IPC.appInfo, () => ({
    version: APP_VERSION,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }));

  ipcMain.handle(IPC.windowControl, (e, action: unknown) => {
    const w = winOf(e);
    if (!w) return false;
    switch (action) {
      case 'minimize': w.minimize(); break;
      case 'maximize': if (w.isMaximized()) w.unmaximize(); else w.maximize(); break;
      case 'close': w.close(); break;
      case 'toggleFullscreen': w.setFullScreen(!w.isFullScreen()); break;
      case 'toggleDevTools': w.webContents.toggleDevTools(); break;
      case 'reload': w.webContents.reload(); break;
      case 'zoomIn': w.webContents.setZoomLevel(Math.min(3, w.webContents.getZoomLevel() + 0.5)); break;
      case 'zoomOut': w.webContents.setZoomLevel(Math.max(-3, w.webContents.getZoomLevel() - 0.5)); break;
      case 'zoomReset': w.webContents.setZoomLevel(0); break;
    }
    return w.isMaximized();
  });

  ipcMain.handle(IPC.isMaximized, (e) => winOf(e)?.isMaximized() ?? false);

  ipcMain.handle(IPC.closeConfirmed, (e) => {
    closeConfirmed = true;
    winOf(e)?.close();
  });

  ipcMain.handle(IPC.quit, () => {
    mainWindow?.close();
  });
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (ev) => ev.preventDefault());
});

void app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      closeConfirmed = false;
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
  else closeConfirmed = false;
});
