import type { SessionPlayer } from '../core/Session';

/**
 * Ping labels (DOM-free, so they are unit-tested). Online only: offline games have no network,
 * so every function returns null for them and nothing is drawn.
 */

/** "42 ms", "reconnecting…" for a dropped player, or null when there is nothing to show. */
export function pingLabel(p: Pick<SessionPlayer, 'connected' | 'ping'>, online: boolean): string | null {
  if (!online) return null;
  if (!p.connected) return 'reconnecting…';
  if (p.ping === undefined || !Number.isFinite(p.ping)) return null;
  return `${Math.max(0, Math.round(p.ping))} ms`;
}

/** Colour band for a ping: good under 80 ms, fair under 160 ms, poor above (or reconnecting). */
export function pingClass(p: Pick<SessionPlayer, 'connected' | 'ping'>): 'good' | 'fair' | 'poor' {
  if (!p.connected) return 'poor';
  const ms = p.ping ?? 0;
  return ms < 80 ? 'good' : ms < 160 ? 'fair' : 'poor';
}

/** The on-screen readout (Show ping): my own link, or null when it shouldn't show. */
export function pingReadout(
  enabled: boolean,
  online: boolean,
  status: 'online' | 'connecting' | 'offline',
  rtt: number,
): string | null {
  if (!enabled || !online) return null;
  if (status !== 'online') return 'reconnecting…';
  return `${Math.max(0, Math.round(rtt))} ms`;
}
