import { join } from 'node:path';
import { app, BrowserWindow, dialog, Menu, nativeTheme, session, shell } from 'electron';
import { startServer } from '../server/src/app.ts';
import { configurePaths } from '../server/src/paths.ts';

// This file is bundled to desktop/dist/main.mjs, so paths are relative to that folder.
const here = import.meta.dirname;
const repoRoot = join(here, '..', '..');

configurePaths(
  app.isPackaged
    ? { scriptsDir: join(process.resourcesPath, 'scripts'), clientDistDir: join(process.resourcesPath, 'client') }
    : { scriptsDir: join(repoRoot, 'server', 'scripts'), clientDistDir: join(repoRoot, 'client', 'dist') },
);

let mainWindow: BrowserWindow | null = null;

/** Window buttons drawn over the app's own top bar, in its colors (--sidebar and --fg-muted in index.css). */
const titleBarOverlay = () =>
  nativeTheme.shouldUseDarkColors
    ? { color: '#09090b', symbolColor: '#9a9aa6', height: 36 }
    : { color: '#efeff2', symbolColor: '#676773', height: 36 };

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 720,
    minHeight: 520,
    title: 'WSL-Vpn',
    icon: join(repoRoot, 'build', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0e0e11' : '#f6f6f8',
    autoHideMenuBar: true,
    // Like VS Code: the app draws the title bar (menus, command center); Windows only the window buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: titleBarOverlay(),
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });

  const origin = `http://127.0.0.1:${port}`;
  mainWindow.loadURL(origin);
  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // External links open in the real browser, never inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });
  const followTheme = () => mainWindow?.setTitleBarOverlay(titleBarOverlay());
  nativeTheme.on('updated', followTheme);
  mainWindow.on('closed', () => {
    nativeTheme.off('updated', followTheme);
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // Only our own server may be loaded by the window.
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'"],
        },
      });
    });
    try {
      const server = await startServer(0);
      app.on('will-quit', server.close);
      createWindow(server.port);
      app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow(server.port));
    } catch (error) {
      dialog.showErrorBox('WSL-Vpn', `Não foi possível iniciar o servidor interno:\n${(error as Error).message}`);
      app.quit();
    }
  });

  // The VPN keeps running inside WSL after the window closes, like with the original panel.
  app.on('window-all-closed', () => app.quit());
}
