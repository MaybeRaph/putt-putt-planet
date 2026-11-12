import type { Theme } from '@ppp/shared';

const SCALES: Record<Theme['music']['scale'], number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonic: [0, 2, 4, 7, 9, 12, 14],
};

const PROGRESSION = [0, 4, 5, 3]; // I V vi IV (scale degrees)

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

/**
 * Procedural, layered background music + ambience. Layers fade in with player count:
 * 1 = pad + bass, 2 = + arpeggio, 3 = + drums, 4 = + lead. A lookahead scheduler keeps timing
 * tight regardless of frame rate.
 */
export class Music {
  private timer: number | null = null;
  private theme: Theme | null = null;
  private step = 0;
  private nextTime = 0;
  private readonly layerGains: GainNode[] = [];
  private ambience: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private seed = 1;
  private melodyNote = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly out: GainNode,
    private readonly noise: AudioBuffer,
  ) {
    for (let i = 0; i < 5; i++) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      this.layerGains.push(g);
    }
  }

  play(theme: Theme, layers: number): void {
    const same = this.theme === theme;
    this.theme = theme;
    this.setLayers(layers);
    if (same && this.timer !== null) return;
    this.stopAmbience();
    this.startAmbience(theme.decorKit);
    if (this.timer === null) {
      this.nextTime = this.ctx.currentTime + 0.1;
      this.step = 0;
      this.timer = window.setInterval(() => this.schedule(), 25);
    }
  }

  setLayers(n: number): void {
    const t = this.ctx.currentTime;
    // 0 = ambience-free base (pad+bass), 1 arp, 2 drums, 3 lead
    const targets = [0.5, n >= 2 ? 0.32 : 0, n >= 3 ? 0.45 : 0, n >= 4 ? 0.22 : 0, 0.4];
    this.layerGains.forEach((g, i) => g.gain.setTargetAtTime(targets[i], t, 0.8));
  }

  stop(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.theme = null;
    this.stopAmbience();
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  private schedule(): void {
    if (!this.theme) return;
    const spb = 60 / this.theme.music.bpm / 4; // 16th note
    while (this.nextTime < this.ctx.currentTime + 0.12) {
      this.playStep(this.step, this.nextTime, spb);
      this.nextTime += spb;
      this.step = (this.step + 1) % 64;
    }
    if (this.rand() < 0.012) this.ambientEvent();
  }

  private note(degree: number, octave: number): number {
    const sc = SCALES[this.theme!.music.scale];
    const d = ((degree % sc.length) + sc.length) % sc.length;
    const o = Math.floor(degree / sc.length);
    return this.theme!.music.root + sc[d] + 12 * (octave + o);
  }

  private voice(
    layer: number,
    midi: number,
    t: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    attack = 0.01,
  ): void {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = mtof(midi);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.layerGains[layer]);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private drum(kind: 'kick' | 'snare' | 'hat', t: number): void {
    const g = this.ctx.createGain();
    g.connect(this.layerGains[2]);
    if (kind === 'kick') {
      const o = this.ctx.createOscillator();
      o.frequency.setValueAtTime(140, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.15);
      g.gain.setValueAtTime(0.7, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.25);
    } else {
      const s = this.ctx.createBufferSource();
      s.buffer = this.noise;
      const f = this.ctx.createBiquadFilter();
      f.type = kind === 'hat' ? 'highpass' : 'bandpass';
      f.frequency.value = kind === 'hat' ? 7000 : 1800;
      const dur = kind === 'hat' ? 0.04 : 0.14;
      g.gain.setValueAtTime(kind === 'hat' ? 0.12 : 0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f).connect(g);
      s.start(t, Math.random() * 0.5);
      s.stop(t + dur + 0.02);
    }
  }

  private playStep(step: number, t: number, spb: number): void {
    const bar = Math.floor(step / 16);
    const s = step % 16;
    const chord = PROGRESSION[bar % 4];
    if (s === 0) {
      // pad: triad, whole bar
      for (const d of [0, 2, 4]) this.voice(0, this.note(chord + d, 0), t, spb * 16, 'triangle', 0.05, 0.4);
      this.seed = 1 + bar * 7919;
    }
    if (s === 0 || s === 8) this.voice(0, this.note(chord, -2), t, spb * 6, 'sine', 0.22, 0.02);
    if (s === 6 || s === 14) this.voice(0, this.note(chord + 4, -2), t, spb * 2, 'sine', 0.12, 0.02);
    // arpeggio
    const arp = [0, 2, 4, 7, 4, 2, 0, 2];
    this.voice(1, this.note(chord + arp[s % 8], 1), t, spb * 1.6, 'square', 0.035);
    // drums
    if (s % 8 === 0) this.drum('kick', t);
    if (s === 4 || s === 12) this.drum('snare', t);
    if (s % 2 === 0) this.drum('hat', t);
    // lead: seeded random walk on 8th notes, rests sometimes
    if (s % 2 === 0 && this.rand() > 0.35) {
      this.melodyNote = Math.max(-2, Math.min(9, this.melodyNote + Math.floor(this.rand() * 5) - 2));
      if (s === 0) this.melodyNote = chord + 4;
      this.voice(
        3,
        this.note(this.melodyNote, 1),
        t,
        spb * (this.rand() > 0.7 ? 4 : 2),
        'sawtooth',
        0.05,
        0.02,
      );
    }
  }

  // ------------------------------------------------------------------------------------------
  // Ambience
  // ------------------------------------------------------------------------------------------

  private startAmbience(kit: Theme['decorKit']): void {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    const g = this.ctx.createGain();
    f.type = 'lowpass';
    f.frequency.value = kit === 'frozen' ? 700 : kit === 'space' ? 180 : kit === 'clockwork' ? 300 : 450;
    g.gain.value = kit === 'frozen' ? 0.12 : kit === 'space' ? 0.2 : 0.05;
    src.connect(f).connect(g).connect(this.layerGains[4]);
    src.start();
    this.ambience = { src, gain: g };
  }

  private stopAmbience(): void {
    if (!this.ambience) return;
    this.ambience.src.stop();
    this.ambience.src.disconnect();
    this.ambience = null;
  }

  /** Occasional ambient flourish: birdsong, chimes, ticks, bleeps. */
  private ambientEvent(): void {
    if (!this.theme) return;
    const t = this.ctx.currentTime + 0.05;
    const kit = this.theme.decorKit;
    const chirp = (f: number, d: number, type: OscillatorType, gain: number, slide: number) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * slide, t + d);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(this.layerGains[4]);
      o.start(t);
      o.stop(t + d + 0.05);
    };
    if (kit === 'meadow')
      for (let i = 0; i < 3; i++)
        setTimeout(() => chirp(2600 + Math.random() * 900, 0.08, 'sine', 0.05, 1.4), i * 110);
    else if (kit === 'candy') chirp(1568 + Math.random() * 400, 0.6, 'sine', 0.04, 1);
    else if (kit === 'clockwork')
      for (let i = 0; i < 4; i++) setTimeout(() => chirp(1800, 0.02, 'square', 0.03, 1), i * 500);
    else if (kit === 'space') chirp(300 + Math.random() * 600, 0.5, 'sine', 0.04, 2.5);
    else chirp(1300, 1.2, 'sine', 0.02, 1.02);
  }
}
