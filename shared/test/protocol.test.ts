import { describe, expect, it } from 'vitest';
import {
  defaultProfile,
  filterChat,
  parseC2S,
  parseS2C,
  sanitizeLoadout,
  sanitizeName,
  DEFAULT_LOADOUT,
} from '../src/index';

describe('protocol validation', () => {
  it('accepts well-formed client messages', () => {
    expect(parseC2S({ t: 'hello', profile: defaultProfile('g_x', 'X') })?.t).toBe('hello');
    expect(parseC2S({ t: 'joinRoom', code: 'ABC123' })?.t).toBe('joinRoom');
    expect(parseC2S({ t: 'shot', seq: 1, dir: [1, 0], power: 0.5 })?.t).toBe('shot');
    expect(parseC2S({ t: 'configure', courseId: 'meadow', mode: 'relay', chaos: false })?.t).toBe(
      'configure',
    );
  });

  it('rejects malformed, oversized or hostile client messages', () => {
    expect(parseC2S({ t: 'shot', seq: 1, dir: [1, 0], power: 'max' })).toBeNull();
    expect(parseC2S({ t: 'shot', seq: 1, dir: [Infinity, 0], power: 1 })).toBeNull();
    expect(parseC2S({ t: 'joinRoom', code: '../../etc' })).toBeNull();
    expect(parseC2S({ t: 'chat', text: 'x'.repeat(500) })).toBeNull();
    expect(parseC2S({ t: 'configure', courseId: 'meadow', mode: 'solo', chaos: false })).toBeNull(); // solo is not an online mode
    expect(parseC2S({ t: 'nope' })).toBeNull();
    expect(parseC2S(null)).toBeNull();
    expect(parseC2S({ t: 'hello', profile: { ...defaultProfile('g_x', 'X'), level: -5 } })).toBeNull();
  });

  it('validates server messages too', () => {
    expect(parseS2C({ t: 'snap', hole: 0, tick: 3, st: 9, balls: [['a', 0, 0, 0, 0, 0, 0, 1]] })?.t).toBe(
      'snap',
    );
    expect(parseS2C({ t: 'snap', hole: 0, tick: 3, st: 9, balls: [['a', 0, 0, 0, 0, 0, 0, 9]] })).toBeNull();
    expect(
      parseS2C({
        t: 'ev',
        hole: 0,
        tick: 1,
        st: 1,
        events: [{ type: 'wall', ball: 'a', entrant: 'a', speed: 3 }],
      })?.t,
    ).toBe('ev');
    expect(parseS2C({ t: 'ev', hole: 0, tick: 1, st: 1, events: [{ type: 'explode' }] })).toBeNull();
  });

  it('filters chat and names', () => {
    expect(filterChat('you are an idiot')).toBe('you are an i****');
    expect(filterChat('hi\u0000there')).toBe('hithere');
    expect(sanitizeName('<script>')).toBe('script');
    expect(sanitizeName('   ')).toBe('Golfer');
  });

  it('sanitizes loadouts (unknown / wrong-slot / unowned items fall back)', () => {
    expect(sanitizeLoadout({ ball: 'hat.crown', hat: 'nope' })).toEqual(DEFAULT_LOADOUT);
    expect(sanitizeLoadout({ ball: 'ball.gold' }, new Set()).ball).toBe(DEFAULT_LOADOUT.ball);
    expect(sanitizeLoadout({ ball: 'ball.gold' }, new Set(['ball.gold'])).ball).toBe('ball.gold');
  });
});
