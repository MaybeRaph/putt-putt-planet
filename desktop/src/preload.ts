import { contextBridge, ipcRenderer } from 'electron';

/** Small, explicit bridge: the game only gets these capabilities from the desktop shell. */
contextBridge.exposeInMainWorld('pppNative', {
  platform: process.platform,
  version: process.env.npm_package_version ?? '',
  startLanServer: (): Promise<{ port: number; addresses: string[] }> => ipcRenderer.invoke('lan:start'),
  stopLanServer: (): Promise<void> => ipcRenderer.invoke('lan:stop'),
  /** Plain-text copy through the OS clipboard (exact bytes, no formatting). */
  copyText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', String(text)),
  /** Display mode: 'windowed' or 'fullscreen' (borderless, covers the taskbar). */
  getDisplayMode: (): Promise<'windowed' | 'fullscreen'> => ipcRenderer.invoke('display:get'),
  setDisplayMode: (mode: 'windowed' | 'fullscreen'): Promise<'windowed' | 'fullscreen'> =>
    ipcRenderer.invoke('display:set', mode === 'fullscreen' ? 'fullscreen' : 'windowed'),
  /** Quit to desktop (the main menu's button). */
  quit: (): Promise<void> => ipcRenderer.invoke('app:quit'),
});
