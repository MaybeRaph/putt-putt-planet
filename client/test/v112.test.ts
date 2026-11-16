import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { emptyStats, type ScoreState } from '@ppp/shared';
import { pickAwards } from '../src/ui/awards';
import { ShotRecorder, samplePath } from '../src/rendering/Replay';
import { PHOTO_FILTERS, photoFileName } from '../src/ui/PhotoMode';
import { DEFAULT_KEYS, DEFAULT_SETTINGS, HUD_SCALE } from '../src/core/settings';

const score = (stats: ScoreState['stats'], entrants = Object.keys(stats ?? {})): ScoreState => ({
  mode: entrants.length > 1 ? 'parallel' : 'solo',
  holeIndex: 0,
  phase: 'courseEnd',
  pars: [3],
  entrants,
  card: Object.fromEntries(entrants.map((e) => [e, [3]])),
  strokesThisHole: {},
  done: {},
  turn: null,
  rescue: [],
  collected: [],
  stats,
});

describe('v1.12 awards', () => {
  it('gives each award to the best player, shares ties and skips awards nobody earned', () => {
    const a = { ...emptyStats(), shots: 20, power: 14, aces: 1, wallHits: 9, coins: 4, birdies: 2 };
    const b = { ...emptyStats(), shots: 31, power: 7, wallHits: 9, hazards: 3, longest: 6.4 };
    const c = { ...emptyStats(), shots: 25, power: 12, wallHits: 2 };
    const awards = pickAwards(score({ a, b, c }), 20);
    const by = Object.fromEntries(awards.map((x) => [x.def.id, x.winners]));
    expect(by.ace).toEqual(['a']);
    expect(by.sniper).toEqual(['b']);
    expect(by.bank).toEqual(['a', 'b']);
    expect(by.splash).toEqual(['b']);
    expect(by.scenic).toEqual(['b']);
    expect(by.power).toEqual(['a']);
    expect(by.feather).toEqual(['b']);
    expect(by.gems).toBeUndefined(); // nobody found one
    expect(pickAwards(score({ a, b, c })).length).toBeLessThanOrEqual(6);
    // An award everybody ties for says nothing.
    expect(pickAwards(score({ a, b }), 20).find((x) => x.def.id === 'bank')).toBeUndefined();
  });

  it('solo shows the highlights you earned (no "most shots" ribbing), and nothing for old hosts', () => {
    const a = { ...emptyStats(), shots: 12, power: 6, aces: 2 };
    const ids = pickAwards(score({ a })).map((x) => x.def.id);
    expect(ids).toContain('ace');
    expect(ids).not.toContain('scenic');
    expect(pickAwards(score(undefined, ['a']))).toEqual([]);
  });
});

describe('v1.12 hole-in-one replay recording', () => {
  it('records the putt and plays it back by time', () => {
    const r = new ShotRecorder();
    r.start(0, new THREE.Vector3(0, 0, 0));
    for (let i = 1; i <= 30; i++) r.sample(i * 33, new THREE.Vector3(i * 0.1, 0, 0));
    expect(r.usable).toBe(true);
    expect(samplePath(r.frames, 0.5).x).toBeCloseTo((0.5 / 0.033) * 0.1, 1);
    expect(samplePath(r.frames, 99).x).toBeCloseTo(3);
    r.start(0, new THREE.Vector3());
    expect(r.usable).toBe(false);
  });
});

describe('v1.12 photo mode and HUD size', () => {
  it('names photos by date and has a filter list starting with Natural', () => {
    expect(photoFileName(new Date(2026, 10, 16, 9, 5, 7))).toBe('putt-putt-planet-2026-11-16-09-05-07.png');
    expect(PHOTO_FILTERS[0].css).toBe('none');
    expect(DEFAULT_KEYS.photo).toBe('KeyP');
  });

  it('HUD size defaults to 100% within 70-140%', () => {
    expect(DEFAULT_SETTINGS.hudScale).toBe(1);
    expect(HUD_SCALE.min).toBeLessThan(1);
    expect(HUD_SCALE.max).toBeGreaterThan(1);
  });
});
