import {
  applyRun,
  applyHopperRun,
  buyUpgrade,
  setKeepsake,
  type HopperMatch,
  type UpgradeId,
  buyCosmetic,
  defaultProfile,
  getLoadout,
  ProfileSchema,
  mergeProfiles,
  type Course,
  type Grant,
  type Loadout,
  type Profile,
  type RunSummary,
} from '@ppp/shared';
import { EventBus } from '../core/EventBus';

// `?profile=b` uses a separate local profile (lets two tabs be two players while testing).
const SLOT = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('profile') : null;
const KEY = `ppp.profile.v1${SLOT ? `.${SLOT}` : ''}`;

const NAMES = [
  'Putter',
  'Birdie',
  'Bogey',
  'Chippy',
  'Dimples',
  'Flagstick',
  'Mulligan',
  'Wedge',
  'Divot',
  'Fairway',
];

function newGuestId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'g_' + [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Local profile persistence (guest id + display name). Always available offline; when online
 * the server merges and becomes authoritative for online-game rewards, then pushes the result
 * back here via replace().
 */
export class ProfileStore {
  profile: Profile;
  readonly bus = new EventBus<{ changed: Profile }>();

  constructor() {
    this.profile = this.load();
  }

  private load(): Profile {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = ProfileSchema.safeParse(JSON.parse(raw));
        if (parsed.success) return parsed.data;
      }
    } catch {
      /* corrupted or unavailable storage: start fresh */
    }
    const p = defaultProfile(
      newGuestId(),
      `${NAMES[Math.floor(Math.random() * NAMES.length)]}${Math.floor(Math.random() * 90 + 10)}`,
    );
    this.save(p);
    return p;
  }

  private save(p: Profile): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
  }

  replace(p: Profile): void {
    this.profile = p;
    this.save(p);
    this.bus.emit('changed', p);
  }

  /** Server copy arrived: keep the union of both (never lose offline progress). */
  mergeFrom(server: Profile): void {
    const merged = mergeProfiles(this.profile, server);
    // No-op merges must not emit, otherwise client and server would echo forever.
    if (JSON.stringify(merged) === JSON.stringify(this.profile)) return;
    this.replace(merged);
  }

  setName(name: string): void {
    const n = name.trim().slice(0, 20) || this.profile.name;
    this.replace({ ...this.profile, name: n });
  }

  equip(slot: keyof Loadout, id: string): void {
    this.replace({ ...this.profile, loadout: { ...this.profile.loadout, [slot]: id } });
  }

  buy(id: string): string | null {
    const r = buyCosmetic(this.profile, id);
    if (typeof r === 'string') return r;
    this.replace(r);
    return null;
  }

  applyRun(run: RunSummary, course: Course | null): Grant {
    const { profile, grant } = applyRun(this.profile, run, course);
    this.replace(profile);
    return grant;
  }

  applyHopperRun(match: HopperMatch, playtimeSec: number): Grant {
    const { profile, grant } = applyHopperRun(this.profile, match, this.profile.id, playtimeSec);
    this.replace(profile);
    return grant;
  }

  buyUpgrade(id: UpgradeId): string | null {
    const r = buyUpgrade(this.profile, id);
    if (typeof r === 'string') return r;
    this.replace(r);
    return null;
  }

  setKeepsake(id: string | null): void {
    this.replace(setKeepsake(this.profile, id));
  }

  loadout(): Loadout {
    return getLoadout(this.profile);
  }

  ownedCollectibles(): Set<string> {
    return new Set(this.profile.collected);
  }
}
