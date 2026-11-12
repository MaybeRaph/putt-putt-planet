import type { Theme } from '@ppp/shared';
import { Music } from './Music';
// A real putter strike (CC0: "putt.wav" by 170129 on freesound.org, sound 408260), inlined as a
// data URL so it loads the same way in the browser, the desktop app and on phones.
import puttWav from './putt.wav?inline';

/**
 * WebAudio engine. Almost every sound is synthesised at runtime; the putter strike is a short
 * recording (with a synthesised fallback until it has decoded).
 * Bus layout: sfx + music + ambience -> master -> compressor -> destination.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  musicBus!: GainNode;
  private noiseBuf!: AudioBuffer;
  music: Music | null = null;
  private vol = { master: 0.8, music: 0.5, sfx: 0.8 };
  private pickupStreak = 0;
  private lastPickup = 0;
  private lastWall = 0;
  private puttBuf: AudioBuffer | null = null;

  /** Must be called from a user gesture (browsers block autoplay). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = this.ctx.createGain();
    this.musicBus.connect(this.master);
    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.music = new Music(this.ctx, this.musicBus, this.noiseBuf);
    const ctx = this.ctx;
    void fetch(puttWav)
      .then((r) => r.arrayBuffer())
      .then((b) => ctx.decodeAudioData(b))
      .then((buf) => (this.puttBuf = buf))
      .catch(() => undefined);
    this.setVolumes(this.vol.master, this.vol.music, this.vol.sfx);
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.vol = { master, music, sfx };
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(sfx, t, 0.05);
  }

  playTheme(theme: Theme | null, layers = 1): void {
    if (!this.music) return;
    if (!theme) this.music.stop();
    else this.music.play(theme, layers);
  }

  // ------------------------------------------------------------------------------------------
  // Synth primitives
  // ------------------------------------------------------------------------------------------

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    opts: { slide?: number; delay?: number; attack?: number } = {},
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + (opts.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    gain: number,
    filter: BiquadFilterType,
    freq: number,
    opts: { q?: number; sweep?: number; delay?: number } = {},
  ): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + (opts.delay ?? 0);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = filter;
    f.frequency.setValueAtTime(freq, t);
    if (opts.sweep) f.frequency.exponentialRampToValueAtTime(freq * opts.sweep, t + dur);
    f.Q.value = opts.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------------------------------
  // Game sounds
  // ------------------------------------------------------------------------------------------

  putt(power: number): void {
    if (this.ctx && this.puttBuf) {
      // The recorded "tock": louder and a touch brighter the harder you hit, with a little
      // variation so repeated putts don't sound identical.
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.puttBuf;
      src.playbackRate.value = 0.92 + power * 0.16 + (Math.random() - 0.5) * 0.04;
      const g = this.ctx.createGain();
      g.gain.value = 0.45 + power * 0.85;
      src.connect(g).connect(this.sfxBus);
      src.start(t);
      if (power > 0.7) this.tone(110, 0.1, 'sine', (power - 0.7) * 0.8, { slide: 0.6 });
      return;
    }
    this.noise(0.05, 0.5 + power * 0.4, 'bandpass', 2400 + power * 1500, { q: 2 });
    this.tone(180 + power * 120, 0.12, 'sine', 0.5, { slide: 0.5 });
    this.tone(900, 0.04, 'triangle', 0.2);
  }

  wall(speed: number): void {
    const now = performance.now();
    if (now - this.lastWall < 40) return;
    this.lastWall = now;
    const v = Math.min(1, speed / 12);
    this.tone(320 + Math.random() * 60, 0.09, 'triangle', 0.15 + v * 0.35, { slide: 0.6 });
    this.noise(0.04, 0.1 + v * 0.3, 'highpass', 1800);
  }

  land(speed: number): void {
    this.tone(140, 0.1, 'sine', Math.min(0.5, speed * 0.06), { slide: 0.6 });
  }

  bumper(): void {
    this.tone(520, 0.22, 'square', 0.18, { slide: 1.8 });
    this.tone(260, 0.25, 'sine', 0.35, { slide: 2.2 });
  }

  boost(): void {
    this.noise(0.4, 0.35, 'bandpass', 600, { q: 3, sweep: 6 });
    this.tone(300, 0.35, 'sawtooth', 0.08, { slide: 3 });
  }

  teleport(): void {
    this.tone(400, 0.35, 'sine', 0.3, { slide: 4 });
    this.tone(800, 0.3, 'triangle', 0.15, { slide: 0.3, delay: 0.1 });
  }

  splash(): void {
    this.noise(0.5, 0.6, 'lowpass', 1800, { sweep: 0.2 });
    this.tone(220, 0.2, 'sine', 0.3, { slide: 0.4 });
  }

  poof(): void {
    this.noise(0.3, 0.4, 'bandpass', 900, { sweep: 0.3, q: 0.8 });
  }

  lipOut(): void {
    this.tone(660, 0.06, 'triangle', 0.3);
    this.tone(560, 0.08, 'triangle', 0.25, { delay: 0.06 });
  }

  cup(): void {
    // ball rattling into the cup
    for (let i = 0; i < 4; i++)
      this.tone(1100 - i * 150, 0.06, 'triangle', 0.25 - i * 0.05, { delay: i * 0.055 });
    this.tone(140, 0.25, 'sine', 0.5, { delay: 0.22, slide: 0.7 });
  }

  pickup(kind: 'coin' | 'gem' | 'golden' | 'crate'): void {
    const now = performance.now();
    this.pickupStreak = now - this.lastPickup < 1500 ? this.pickupStreak + 1 : 0;
    this.lastPickup = now;
    const base = 880 * Math.pow(2, Math.min(12, this.pickupStreak) / 12);
    if (kind === 'coin') {
      this.tone(base, 0.08, 'square', 0.12);
      this.tone(base * 1.5, 0.15, 'square', 0.12, { delay: 0.06 });
    } else {
      const notes = kind === 'golden' ? [1, 1.25, 1.5, 2, 2.5] : [1, 1.26, 1.5, 2];
      notes.forEach((n, i) => this.tone(base * n * 0.75, 0.25, 'triangle', 0.2, { delay: i * 0.07 }));
    }
  }

  fanfare(big: boolean): void {
    const seq = big ? [1, 1.25, 1.5, 2, 1.5, 2, 2.5] : [1, 1.25, 1.5, 2];
    seq.forEach((n, i) => {
      this.tone(523 * n, 0.3, 'square', 0.1, { delay: i * 0.1 });
      this.tone(523 * n * 0.5, 0.3, 'triangle', 0.15, { delay: i * 0.1 });
    });
  }

  sad(): void {
    [1, 0.94, 0.89, 0.84].forEach((n, i) => this.tone(330 * n, 0.3, 'triangle', 0.15, { delay: i * 0.18 }));
  }

  ui(kind: 'click' | 'hover' | 'back' | 'buy' | 'error' = 'click'): void {
    if (kind === 'hover') this.tone(1200, 0.03, 'sine', 0.04);
    else if (kind === 'back') this.tone(500, 0.08, 'triangle', 0.15, { slide: 0.7 });
    else if (kind === 'buy')
      [1, 1.5, 2].forEach((n, i) => this.tone(700 * n, 0.12, 'square', 0.1, { delay: i * 0.06 }));
    else if (kind === 'error') this.tone(160, 0.2, 'square', 0.12);
    else this.tone(800, 0.05, 'triangle', 0.18, { slide: 1.4 });
  }

  levelUp(): void {
    [1, 1.25, 1.5, 2, 2.5, 3].forEach((n, i) => this.tone(440 * n, 0.25, 'square', 0.1, { delay: i * 0.08 }));
  }

  xpTick(): void {
    this.tone(1400 + Math.random() * 200, 0.03, 'sine', 0.05);
  }

  emote(): void {
    this.tone(700, 0.08, 'sine', 0.2, { slide: 1.5 });
  }

  turn(): void {
    this.tone(660, 0.1, 'sine', 0.2);
    this.tone(990, 0.15, 'sine', 0.2, { delay: 0.1 });
  }
}

export const audio = new AudioEngine();
