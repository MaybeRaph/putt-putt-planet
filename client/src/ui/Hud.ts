import * as THREE from 'three';
import { RULES, MODE_INFO, type Course, type ScoreState } from '@ppp/shared';
import { h, clear, pulse, scoreName, relScore, tweenNumber, esc } from './dom';
import type { SessionPlayer } from '../core/Session';
import { powerColor, type Palette } from '../rendering/AimView';
import { HopperHud } from './HopperHud';

const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
/** Hole tips are written for mouse/keyboard; reword them on touch screens. */
export function touchify(text: string): string {
  if (!coarse) return text;
  return text
    .replace(/\s*\(or hold Space\)/g, '')
    .replace(/right-drag or Q\/E/g, 'a one-finger drag away from the ball')
    .replace(/Press R \(or ⛑ Rescue\)/g, 'Tap ⛑ Rescue');
}

export const EMOTES = ['👍', '😂', '😮', '😭', '🔥', '🎉', '👏', '😎'];

export interface HudCallbacks {
  onOverview(): void;
  onRescue(): void;
  onPause(): void;
  onNext(): void;
  onEmote(e: string): void;
  onChat(text: string): void;
  onVote(option: number): void;
  onReroll(): void;
}

/** In-game HTML overlay: hole info, strokes, power meter, scoreboard, counters, messages. */
export class Hud {
  readonly root: HTMLElement;
  private readonly holeTitle: HTMLElement;
  private readonly holeMeta: HTMLElement;
  private readonly strokesEl: HTMLElement;
  private readonly pips: HTMLElement;
  private readonly board: HTMLElement;
  private readonly counters: Record<'coin' | 'gem' | 'golden' | 'crate', HTMLElement>;
  private readonly msg: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly meterPct: HTMLElement;
  private readonly rescueBtn: HTMLButtonElement;
  private readonly tip: HTMLElement;
  private readonly turnBanner: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly chatLog: HTMLElement;
  private readonly chatInput: HTMLInputElement;
  private readonly labels = new Map<string, HTMLElement>();
  private readonly labelLayer: HTMLElement;
  private readonly wheel: HTMLElement;
  private readonly fullBoard: HTMLElement;
  private counts = { coin: 0, gem: 0, golden: 0, crate: 0 };
  palette: Palette = 'default';
  private msgTimer = 0;
  /** Planet Hopper run overlay (hopper mode only). */
  readonly hopper: HopperHud | null = null;

  constructor(
    parent: HTMLElement,
    private readonly course: Course,
    private readonly cb: HudCallbacks,
    private readonly online: boolean,
  ) {
    this.counters = {
      coin: h('b', {}, '0'),
      gem: h('b', {}, '0'),
      golden: h('b', {}, '0'),
      crate: h('b', {}, '0'),
    };
    this.holeTitle = h('div', { class: 'hole-title' });
    this.holeMeta = h('div', { class: 'hole-meta' });
    this.strokesEl = h('div', { class: 'strokes' }, '0');
    this.pips = h('div', { class: 'pips' });
    this.board = h('div', { class: 'board' });
    this.msg = h('div', { class: 'big-msg' });
    this.meterFill = h('div', { class: 'meter-fill' });
    this.meterPct = h('div', { class: 'meter-pct' });
    this.meter = h(
      'div',
      { class: 'meter hidden' },
      h(
        'div',
        { class: 'meter-track' },
        this.meterFill,
        ...[1, 2, 3, 4].map((i) => h('i', { style: `left:${i * 20}%` })),
      ),
      this.meterPct,
    );
    this.rescueBtn = h(
      'button',
      { class: 'btn hud-btn rescue hidden', title: 'Free reposition (R)', onclick: () => cb.onRescue() },
      '⛑ Rescue',
    );
    this.tip = h('div', { class: 'tip hidden' });
    this.turnBanner = h('div', { class: 'turn-banner hidden' });
    this.summary = h('div', { class: 'summary hidden' });
    this.chatLog = h('div', { class: 'chat-log' });
    this.chatInput = h('input', {
      class: 'chat-input hidden',
      maxlength: RULES.chatMaxLength,
      placeholder: 'Say something nice… (Enter)',
    });
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const t = this.chatInput.value.trim();
        if (t) cb.onChat(t);
        this.chatInput.value = '';
        this.toggleChat(false);
      } else if (e.key === 'Escape') this.toggleChat(false);
    });
    this.labelLayer = h('div', { class: 'labels' });
    this.wheel = h(
      'div',
      { class: 'emote-wheel hidden' },
      ...EMOTES.map((e, i) => {
        const a = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2;
        return h(
          'button',
          {
            class: 'emote',
            style: `transform: translate(${Math.cos(a) * 78}px, ${Math.sin(a) * 78}px)`,
            onclick: () => {
              cb.onEmote(e);
              this.toggleWheel(false);
            },
          },
          e,
        );
      }),
      h('div', { class: 'wheel-center' }, 'Emote'),
    );
    this.fullBoard = h('div', { class: 'full-board hidden' });

    this.root = h(
      'div',
      { class: 'hud' },
      this.labelLayer,
      h(
        'div',
        { class: 'hud-tl panel' },
        this.holeTitle,
        this.holeMeta,
        h('div', { class: 'stroke-row' }, h('span', { class: 'lbl' }, 'Strokes'), this.strokesEl),
        this.pips,
      ),
      h(
        'div',
        { class: 'hud-tr' },
        this.board,
        h(
          'div',
          { class: 'counters panel' },
          h('span', { class: 'ct coin', title: 'Coins this run' }, '🪙 ', this.counters.coin),
          h('span', { class: 'ct gem', title: 'Gems this run' }, '💎 ', this.counters.gem),
          h('span', { class: 'ct golden', title: 'Golden balls this run' }, '🏆 ', this.counters.golden),
          h('span', { class: 'ct crate', title: 'Crates this run' }, '🎁 ', this.counters.crate),
        ),
      ),
      this.turnBanner,
      this.msg,
      this.tip,
      this.meter,
      this.summary,
      this.fullBoard,
      this.wheel,
      h('div', { class: 'chat' }, this.chatLog, this.chatInput),
      h(
        'div',
        { class: 'hud-br' },
        this.rescueBtn,
        h(
          'button',
          { class: 'btn hud-btn', title: 'Overview camera (T)', onclick: () => cb.onOverview() },
          '🗺',
        ),
        h('button', { class: 'btn hud-btn', title: 'Emotes (G)', onclick: () => this.toggleWheel() }, '😀'),
        online
          ? h(
              'button',
              { class: 'btn hud-btn', title: 'Chat (Enter)', onclick: () => this.toggleChat() },
              '💬',
            )
          : null,
        h('button', { class: 'btn hud-btn', title: 'Pause (Esc)', onclick: () => cb.onPause() }, '⏸'),
      ),
    );
    parent.appendChild(this.root);
    if (course.id === 'hopper')
      this.hopper = new HopperHud(this.root, { vote: (i) => cb.onVote(i), reroll: () => cb.onReroll() });
  }

  setHole(index: number, score: ScoreState): void {
    const hole = this.course.holes[index];
    this.holeTitle.textContent = `${hole?.name ?? 'Daily'}`;
    this.holeMeta.textContent =
      this.course.id === 'hopper'
        ? `Planet Hopper · Par ${hole.par}`
        : `${this.course.name} · Hole ${index + 1}/${this.course.holes.length} · Par ${hole.par}`;
    this.summary.classList.add('hidden');
    pulse(this.holeTitle.parentElement!, 'slide-in');
    this.updateScore(score, '');
    if (hole.tip) this.showTip(hole.tip);
    else this.tip.classList.add('hidden');
  }

  showTip(text: string): void {
    this.tip.textContent = `💡 ${touchify(text)}`;
    this.tip.classList.remove('hidden');
    pulse(this.tip, 'pop');
  }

  hideTip(): void {
    this.tip.classList.add('hidden');
  }

  updateScore(score: ScoreState, myEntrant: string, players: SessionPlayer[] = []): void {
    const hole = this.course.holes[score.holeIndex];
    if (!hole) return;
    const s = score.strokesThisHole[myEntrant] ?? 0;
    if (this.strokesEl.textContent !== String(s)) {
      this.strokesEl.textContent = String(s);
      pulse(this.strokesEl, 'pop');
    }
    const limit = score.hopper?.strokeLimit || hole.par + RULES.strokeLimitOverPar;
    clear(this.pips);
    for (let i = 0; i < limit; i++)
      this.pips.append(
        h('i', {
          class: `${i < s ? 'used' : ''} ${i === hole.par - 1 ? 'par' : ''}`,
          title: i === hole.par - 1 ? 'Par' : '',
        }),
      );

    // Mini scoreboard
    clear(this.board);
    if (score.entrants.length > 1 || score.mode === 'relay') {
      const nameOf = (e: string) => (e === 'team' ? 'Team' : (players.find((p) => p.id === e)?.name ?? '?'));
      const parSoFar = score.pars.slice(0, score.holeIndex).reduce((a, b) => a + b, 0);
      const rows = score.entrants.map((e) => {
        const total = (score.card[e] ?? [])
          .slice(0, score.holeIndex)
          .reduce<number>((a, b) => a + (b ?? 0), 0);
        const now = score.strokesThisHole[e] ?? 0;
        const turn =
          score.mode === 'relay' && score.turn ? players.find((p) => p.id === score.turn)?.name : null;
        const p = players.find((x) => x.id === e);
        return h(
          'div',
          { class: `row ${e === myEntrant ? 'me' : ''} ${p && !p.connected ? 'dc' : ''}` },
          h(
            'span',
            { class: 'nm' },
            nameOf(e),
            turn && e === 'team' ? h('small', {}, ` · ${turn}'s turn`) : null,
          ),
          h('span', { class: 'now' }, score.done[e] ? '✓' : String(now)),
          h('span', { class: 'tot' }, relScore(total, parSoFar)),
        );
      });
      if (score.mode === 'parallel') {
        const teamTotal = score.entrants.reduce(
          (a, e) =>
            a + (score.card[e] ?? []).slice(0, score.holeIndex).reduce<number>((x, y) => x + (y ?? 0), 0),
          0,
        );
        rows.push(
          h(
            'div',
            { class: 'row team' },
            h('span', { class: 'nm' }, 'Team'),
            h('span', { class: 'now' }, ''),
            h('span', { class: 'tot' }, relScore(teamTotal, parSoFar * score.entrants.length)),
          ),
        );
      }
      this.board.append(h('div', { class: 'panel' }, ...rows));
    }
    this.rescueBtn.classList.toggle('hidden', !score.rescue.includes(myEntrant));
    if (this.hopper && score.hopper) {
      this.holeMeta.textContent = `Planet Hopper · Par ${hole.par} · limit ${score.hopper.strokeLimit}`;
      this.hopper.update(score, players, myEntrant);
      if (score.hopper.choice) this.summary.classList.add('hidden');
    }
  }

  /** Full-card scoreboard (Tab). */
  showFullBoard(show: boolean, score?: ScoreState, players: SessionPlayer[] = []): void {
    this.fullBoard.classList.toggle('hidden', !show);
    if (!show || !score) return;
    clear(this.fullBoard);
    this.fullBoard.append(scorecard(this.course, score, players));
  }

  setMeter(visible: boolean, power: number): void {
    this.meter.classList.toggle('hidden', !visible);
    if (!visible) return;
    this.meterFill.style.width = `${power * 100}%`;
    this.meterFill.style.background = `#${powerColor(power, this.palette).getHexString()}`;
    this.meterPct.textContent = `${Math.round(power * 100)}%`;
  }

  message(text: string, kind: 'good' | 'bad' | 'info' | 'epic' = 'info', ms = 1600): void {
    this.msg.className = `big-msg ${kind}`;
    this.msg.textContent = text;
    pulse(this.msg, 'show');
    clearTimeout(this.msgTimer);
    this.msgTimer = window.setTimeout(() => this.msg.classList.remove('show'), ms);
  }

  turn(text: string, mine: boolean): void {
    this.turnBanner.textContent = text;
    this.turnBanner.className = `turn-banner ${mine ? 'mine' : ''}`;
    pulse(this.turnBanner, 'show');
  }

  hideTurn(): void {
    this.turnBanner.classList.add('hidden');
  }

  collect(kind: 'coin' | 'gem' | 'golden' | 'crate'): void {
    const el = this.counters[kind];
    const from = this.counts[kind];
    this.counts[kind]++;
    void tweenNumber(el, from, this.counts[kind], 300);
    pulse(el.parentElement!, 'pop');
  }

  setCounts(c: Partial<Record<'coin' | 'gem' | 'golden' | 'crate', number>>): void {
    for (const k of Object.keys(this.counters) as (keyof typeof this.counters)[]) {
      this.counts[k] = c[k] ?? 0;
      this.counters[k].textContent = String(this.counts[k]);
    }
  }

  holeSummary(score: ScoreState, myEntrant: string, players: SessionPlayer[], canAdvance: boolean): void {
    const hole = this.course.holes[score.holeIndex];
    const mine = score.card[myEntrant]?.[score.holeIndex];
    clear(this.summary);
    const last = !score.hopper && score.holeIndex + 1 >= this.course.holes.length;
    const hs = score.hopper;
    const rest = hs?.stages[hs.stage]?.kind === 'rest';
    const heartLine = (d: number) => (d > 0 ? `+${d} ❤` : d < 0 ? `${d} ❤` : '±0 ❤');
    this.summary.append(
      ...(
        [
          h(
            'div',
            { class: 'summary-title' },
            rest ? '🌿 Rested' : mine != null ? scoreName(mine, hole.par) : 'Hole complete',
          ),
          hs?.lastDelta && !rest
            ? h(
                'div',
                { class: `summary-hearts ${hs.lastDelta.net < 0 ? 'bad' : hs.lastDelta.net > 0 ? 'good' : ''}` },
                `Team ${heartLine(hs.lastDelta.net)} · ${hs.hearts}/${hs.maxHearts} hearts left`,
              )
            : null,
          h(
            'div',
            { class: 'summary-sub' },
            `${hole.name} · Par ${hole.par}${mine != null ? ` · ${mine} stroke${mine === 1 ? '' : 's'}` : ''}`,
          ),
          score.entrants.length > 1
            ? h(
                'div',
                { class: 'summary-rows' },
                ...score.entrants.map((e) => {
                  const n = e === 'team' ? 'Team' : (players.find((p) => p.id === e)?.name ?? '?');
                  const v = score.card[e]?.[score.holeIndex];
                  return h(
                    'div',
                    { class: 'row' },
                    h('span', {}, n),
                    h(
                      'b',
                      {},
                      v == null ? '-' : `${v} (${relScore(v, hole.par)})`,
                      hs?.lastDelta && !rest ? ` · ${heartLine(hs.lastDelta.by[e] ?? 0)}` : '',
                    ),
                  );
                }),
              )
            : null,
          canAdvance
            ? h(
                'button',
                { class: 'btn primary', onclick: () => this.cb.onNext() },
                hs ? 'Continue ▶' : last ? 'Finish course ▶' : 'Next hole ▶',
              )
            : h('div', { class: 'summary-wait' }, hs ? 'Continuing…' : last ? 'Finishing…' : 'Next hole starting…'),
        ] as (HTMLElement | null)[]
      ).filter((x): x is HTMLElement => x !== null),
    );
    this.summary.classList.remove('hidden');
    pulse(this.summary, 'pop');
  }

  hideSummary(): void {
    this.summary.classList.add('hidden');
  }

  toggleChat(force?: boolean): void {
    if (!this.online) return;
    const show = force ?? this.chatInput.classList.contains('hidden');
    this.chatInput.classList.toggle('hidden', !show);
    if (show) this.chatInput.focus();
    else this.chatInput.blur();
  }

  toggleWheel(force?: boolean): void {
    const show = force ?? this.wheel.classList.contains('hidden');
    this.wheel.classList.toggle('hidden', !show);
  }

  chat(name: string, text: string): void {
    const line = h('div', { class: 'chat-line', html: `<b>${esc(name)}:</b> ${esc(text)}` });
    this.chatLog.append(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild!.remove();
    setTimeout(() => line.classList.add('fade'), 8000);
  }

  feed(text: string): void {
    const line = h('div', { class: 'chat-line sys' }, text);
    this.chatLog.append(line);
    while (this.chatLog.children.length > 6) this.chatLog.firstChild!.remove();
    setTimeout(() => line.classList.add('fade'), 5000);
  }

  /** Floating label (name / emote bubble) above a 3D point. */
  label(
    id: string,
    text: string,
    world: THREE.Vector3 | null,
    camera: THREE.Camera,
    cls = 'name-label',
  ): void {
    let el = this.labels.get(id);
    if (!world) {
      el?.classList.add('hidden');
      return;
    }
    if (!el) {
      el = h('div', { class: cls });
      this.labels.set(id, el);
      this.labelLayer.append(el);
    }
    if (el.textContent !== text) el.textContent = text;
    const p = world.clone().project(camera);
    const visible = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1;
    el.classList.toggle('hidden', !visible);
    el.style.transform = `translate(-50%, -100%) translate(${((p.x + 1) / 2) * innerWidth}px, ${((1 - p.y) / 2) * innerHeight}px)`;
  }

  removeLabel(id: string): void {
    this.labels.get(id)?.remove();
    this.labels.delete(id);
  }

  dispose(): void {
    this.hopper?.dispose();
    this.root.remove();
  }
}

/** Full scorecard table, shared by the HUD (Tab) and the results screen. */
export function scorecard(course: Course, score: ScoreState, players: SessionPlayer[]): HTMLElement {
  const nameOf = (e: string) => (e === 'team' ? 'Team' : (players.find((p) => p.id === e)?.name ?? '?'));
  const head = h(
    'tr',
    {},
    h('th', {}, 'Hole'),
    ...course.holes.map((_, i) => h('th', { class: i === score.holeIndex ? 'cur' : '' }, String(i + 1))),
    h('th', {}, 'Total'),
  );
  const pars = h(
    'tr',
    { class: 'par' },
    h('td', {}, 'Par'),
    ...score.pars.map((p) => h('td', {}, String(p))),
    h('td', {}, String(score.pars.reduce((a, b) => a + b, 0))),
  );
  const rows = score.entrants.map((e) => {
    const card = score.card[e] ?? [];
    const total = card.reduce<number>((a, b) => a + (b ?? 0), 0);
    const parPlayed = card.reduce<number>((a, b, i) => a + (b == null ? 0 : score.pars[i]), 0);
    return h(
      'tr',
      {},
      h('td', { class: 'nm' }, nameOf(e)),
      ...card.map((v, i) => {
        const cls =
          v == null
            ? ''
            : v === 1
              ? 'ace'
              : v < score.pars[i]
                ? 'under'
                : v > score.pars[i]
                  ? 'over'
                  : 'even';
        return h('td', { class: cls }, v == null ? '·' : String(v));
      }),
      h('td', { class: 'tot' }, `${total} (${relScore(total, parPlayed)})`),
    );
  });
  return h(
    'div',
    { class: 'scorecard panel' },
    h('div', { class: 'sc-title' }, `${course.name} — ${MODE_INFO[score.mode].label}`),
    h('table', {}, head, pars, ...rows),
  );
}
