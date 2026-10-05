import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Store } from './store';
import { AuthService } from './auth';
import { Runner } from './runner';
import { toResult } from './ipc';
import { CHANNELS, createHandlers } from '../core/api';
import { startUpdates, updateBlocker } from './updater';
const dev = process.argv.includes('--dev');
// Tests and portable setups can point the app at a separate data folder. Must run before the instance lock.
if (process.env.RESEARCH_BOT_USER_DATA) app.setPath('userData', process.env.RESEARCH_BOT_USER_DATA);
// A second launch only focuses the first window; it must not open the database or create a window.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
app.on('second-instance', () => {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
let win: BrowserWindow;
let store: Store;
let auth: AuthService;
let runner: Runner;
function register(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(channel, (event, ...args) =>
    toResult(() => {
      const url = event.senderFrame?.url;
      if (
        event.sender !== win.webContents ||
        !url ||
        (dev
          ? new URL(url).origin !== 'http://127.0.0.1:5173'
          : url !== pathToFileURL(join(app.getAppPath(), 'dist/index.html')).href)
      )
        throw new Error('Untrusted application request.');
      return handler(...args);
    }),
  );
}
app.whenReady().then(() => {
  if (!primary) return;
  store = new Store(join(app.getPath('userData'), 'research.sqlite'));
  store.failInterruptedRuns();
  const credentials = {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'),
    encrypt: (s: string) => safeStorage.encryptString(s),
    decrypt: (b: Buffer) => safeStorage.decryptString(b),
  };
  auth = new AuthService(join(app.getPath('userData'), 'account'), url => shell.openExternal(url), credentials);
  const appIcon = app.isPackaged
    ? join(process.resourcesPath, 'app-icon.png')
    : join(app.getAppPath(), 'public/app-icon.png');
  win = new BrowserWindow({
    width: 1440,
    height: 950,
    minWidth: 860,
    minHeight: 620,
    title: 'Research Bot',
    icon: appIcon,
    backgroundColor: '#f6f5ef',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  runner = new Runner(store, auth, join(app.getAppPath(), 'agents'), event => {
    if (!win.isDestroyed()) win.webContents.send('agents:event', event);
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  win.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Stay', 'Leave without saving'],
      defaultId: 0,
      cancelId: 0,
      title: 'Unsaved research notes',
      message: 'Your latest changes have not been saved.',
      detail: 'Stay in Research Bot and save your notes before closing.',
    });
    if (choice === 1) event.preventDefault();
  });
  const handlers = createHandlers({
    store,
    auth,
    runner,
    saveFile: async file => {
      const output = await dialog.showSaveDialog(win, {
        defaultPath: file.name,
        filters: [
          file.kind === 'json' ? { name: 'JSON', extensions: ['json'] } : { name: 'Markdown', extensions: ['md'] },
        ],
      });
      if (output.canceled || !output.filePath) return { saved: false };
      await writeFile(output.filePath, file.content, 'utf8');
      return { saved: true, path: output.filePath };
    },
    openUrl: url => shell.openExternal(url),
  });
  for (const [channel, name] of Object.entries(CHANNELS))
    register(channel, (...args) => (handlers[name] as (...values: unknown[]) => unknown)(...args));
  if (dev) void win.loadURL('http://127.0.0.1:5173');
  else void win.loadFile(join(app.getAppPath(), 'dist/index.html'));

  const blocker = updateBlocker({ isPackaged: app.isPackaged, dev, platform: process.platform, env: process.env });
  if (blocker) console.info(`Automatic updates are off: ${blocker}.`);
  else
    startUpdates(autoUpdater, {
      enabled: () => store.getSettings().autoUpdate,
      askToRestart: async version => {
        if (win.isDestroyed()) return false;
        const { response } = await dialog.showMessageBox(win, {
          type: 'info',
          buttons: ['Restart now', 'Later'],
          defaultId: 0,
          cancelId: 1,
          title: 'Update ready',
          message: `Research Bot ${version} is ready to install.`,
          detail: 'Restart to finish updating. If you choose Later, the update installs the next time you quit.',
        });
        return response === 0;
      },
      log: message => console.warn(message),
    });
});
app.on('window-all-closed', () => {
  runner?.stop();
  auth?.cancelSignIn();
  app.quit();
});
app.on('before-quit', () => {
  runner?.stop();
  auth?.cancelSignIn();
});
app.on('will-quit', () => store?.close());
