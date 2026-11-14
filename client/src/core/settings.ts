import type { AntiAlias, Quality } from '../rendering/Renderer';
import type { Palette } from '../rendering/AimView';

export type Action =
  | 'aimLeft'
  | 'aimRight'
  | 'shoot'
  | 'camLeft'
  | 'camRight'
  | 'zoomIn'
  | 'zoomOut'
  | 'overview'
  | 'rescue'
  | 'emote'
  | 'chat'
  | 'scoreboard'
  | 'spectate'
  | 'debug';

export const ACTION_LABELS: Record<Action, string> = {
  aimLeft: 'Aim left',
  aimRight: 'Aim right',
  shoot: 'Charge / shoot',
  camLeft: 'Camera left',
  camRight: 'Camera right',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  overview: 'Overview camera',
  rescue: 'Rescue ball',
  emote: 'Emote wheel',
  chat: 'Chat',
  scoreboard: 'Scoreboard',
  spectate: 'Switch who you watch',
  debug: 'Debug overlay',
};

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: Quality;
  /** Anti-aliasing method ('auto' = the quality preset's choice). */
  aa: AntiAlias;
  /** Film grain filter strength, 0 (off) to 100. */
  grain: number;
  /** The golden-hour sun drifts slowly across the sky (off under reduced motion too). */
  movingSun: boolean;
  reducedMotion: boolean;
  palette: Palette;
  camSensitivity: number;
  invertY: boolean;
  showFps: boolean;
  /** On-screen readout of your connection's ping (online games only). */
  showPing: boolean;
  keys: Record<Action, string>;
}

export const DEFAULT_KEYS: Record<Action, string> = {
  aimLeft: 'ArrowLeft',
  aimRight: 'ArrowRight',
  shoot: 'Space',
  camLeft: 'KeyQ',
  camRight: 'KeyE',
  zoomIn: 'KeyW',
  zoomOut: 'KeyS',
  overview: 'KeyT',
  rescue: 'KeyR',
  emote: 'KeyG',
  chat: 'Enter',
  scoreboard: 'Tab',
  spectate: 'KeyF',
  debug: 'Backquote',
};

const isMobile = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.5,
  sfx: 0.8,
  quality: isMobile ? 'medium' : 'high',
  aa: 'auto',
  grain: 0,
  movingSun: true,
  reducedMotion: typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  palette: 'default',
  camSensitivity: 1,
  invertY: false,
  showFps: false,
  showPing: false,
  keys: { ...DEFAULT_KEYS },
};

const KEY = 'ppp.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...structuredClone(DEFAULT_SETTINGS),
      ...parsed,
      keys: { ...DEFAULT_KEYS, ...(parsed.keys ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings stay in memory */
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    Space: 'Space',
    Backquote: '`',
    Enter: 'Enter',
    Tab: 'Tab',
  };
  return map[code] ?? code;
}
