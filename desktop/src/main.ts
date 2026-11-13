import { app, BrowserWindow, clipboard, ipcMain, Menu, net, protocol, shell, utilityProcess, type UtilityProcess } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import netNode from 'node:net';
import { pathToFileURL } from 'node:url';

/**
 * Desktop shell for Putt-Putt Planet.
 *  - Serves the bundled web game from app://game/ (stable origin for saves, no file:// quirks)
 *  - backgroundThrottling off: a direct-game host keeps simulating while the window is hidden
 *  - Optional LAN server: runs the bundled game server for friends on the same network
 */

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

const appDir = path.join(__dirname, '..', 'app');
let win: BrowserWindow | null = null;
let lan: { proc: UtilityProcess; port: number } | null = null;

type DisplayMode = 'windowed' | 'fullscreen';
const prefsFile = () => path.join(app.getPath('userData'), 'display.json');
function loadDisplayMode(): DisplayMode {
  try {
    const p = JSON.parse(fs.readFileSync(prefsFile(), 'utf8')) as { mode?: string };
    return p.mode === 'fullscreen' ? 'fullscreen' : 'windowed';
  } catch {
    return 'windowed';
  }
}
function saveDisplayMode(mode: DisplayMode): void {
  try {
    fs.writeFileSync(prefsFile(), JSON.stringify({ mode }));
  } catch {
    /* prefs are optional */
  }
}
function currentMode(): DisplayMode {
  return win?.isFullScreen() ? 'fullscreen' : 'windowed';
}
function setDisplayMode(mode: DisplayMode): DisplayMode {
  if (!win) return 'windowed';
  // Electron's fullscreen is a borderless window covering the whole display (and taskbar) on
  // Windows/Linux; on macOS it is the native fullscreen space.
  win.setFullScreen(mode === 'fullscreen');
  saveDisplayMode(mode);
  return mode;
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 820,
    minHeight: 520,
    backgroundColor: '#4aa8ff',
    title: 'Putt-Putt Planet',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  // F11 and Alt+Enter toggle fullscreen everywhere (Windows has no menu bar to do it from).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.key === 'Enter' && input.alt)) {
      e.preventDefault();
      setDisplayMode(currentMode() === 'fullscreen' ? 'windowed' : 'fullscreen');
    }
  });
  win.on('enter-full-screen', () => saveDisplayMode('fullscreen'));
  win.on('leave-full-screen', () => saveDisplayMode('windowed'));
  if (loadDisplayMode() === 'fullscreen') win.setFullScreen(true);
  void win.loadURL('app://game/index.html');
  win.on('closed', () => (win = null));
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  return out;
}

function freePort(start: number): Promise<number> {
  return new Promise((resolve) => {
    const s = netNode.createServer();
    s.once('error', () => resolve(freePort(start + 1)));
    s.listen(start, '0.0.0.0', () => s.close(() => resolve(start)));
  });
}

async function startLan(): Promise<{ port: number; addresses: string[] }> {
  if (lan) return { port: lan.port, addresses: lanAddresses() };
  const port = await freePort(8787);
  const serverPath = app.isPackaged
    ? path.join(process.resourcesPath, 'server.mjs')
    : path.join(__dirname, '..', '..', 'server', 'dist', 'server.js');
  const proc = utilityProcess.fork(serverPath, [], {
    serviceName: 'Putt-Putt Planet LAN server',
    env: { ...process.env, PORT: String(port), DATA_DIR: path.join(app.getPath('userData'), 'lan-server'), STATIC_DIR: appDir },
    stdio: 'pipe',
  });
  proc.stdout?.on('data', (d) => console.log(`[lan] ${String(d).trim()}`));
  proc.stderr?.on('data', (d) => console.error(`[lan] ${String(d).trim()}`));
  proc.on('exit', () => (lan = null));
  lan = { proc, port };
  // Wait until it answers /health.
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return { port, addresses: lanAddresses() };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill();
  lan = null;
  throw new Error('The local network server did not start');
}

function stopLan(): void {
  lan?.proc.kill();
  lan = null;
}

app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    let p = decodeURIComponent(u.pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.join(appDir, path.normalize(p));
    if (!file.startsWith(appDir)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.handle('lan:start', () => startLan());
  ipcMain.handle('lan:stop', () => stopLan());
  ipcMain.handle('clipboard:write', (_e, text: unknown) => clipboard.writeText(String(text)));
  ipcMain.handle('display:get', () => currentMode());
  ipcMain.handle('display:set', (_e, mode: unknown) => setDisplayMode(mode === 'fullscreen' ? 'fullscreen' : 'windowed'));
  // Quit to desktop: a full quit on every platform (macOS included); before-quit stops the LAN server.
  ipcMain.handle('app:quit', () => app.quit());
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'reload' }, { role: 'toggleDevTools' }] },
        { role: 'windowMenu' },
      ]),
    );
  } else Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => {
  stopLan();
  if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', stopLan);
