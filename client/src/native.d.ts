/** Bridge exposed by the desktop (Electron) shell via its preload script. Absent on web/iOS. */
interface PppNative {
  platform: string;
  version: string;
  /** Start the bundled game server on the LAN; resolves with its port and this machine's IPv4s. */
  startLanServer?: () => Promise<{ port: number; addresses: string[] }>;
  stopLanServer?: () => Promise<void>;
  /** Plain-text copy through the OS clipboard. */
  copyText?: (text: string) => Promise<void>;
  getDisplayMode?: () => Promise<'windowed' | 'fullscreen'>;
  setDisplayMode?: (mode: 'windowed' | 'fullscreen') => Promise<'windowed' | 'fullscreen'>;
}

interface Window {
  pppNative?: PppNative;
}
