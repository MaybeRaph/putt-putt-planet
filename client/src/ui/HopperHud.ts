import {
  OMENS,
  REWARDS,
  SKELETON,
  TRINKETS,
  type ChoiceOption,
  type HopperState,
  type ScoreState,
} from '@ppp/shared';
import { h, clear, pulse } from './dom';
import type { SessionPlayer } from '../core/Session';

export const WORLD_LABEL: Record<string, string> = {
  meadow: '🌼 Meadow',
  candy: '🍭 Candy',
  frozen: '❄️ Frozen',
  clockwork: '⚙️ Clockwork',
  space: '🪐 Space',
};

/** Vote countdown line: the plain auto-pick timer, or the majority hint once the host cut it. */
export function choiceTimerText(seconds: number, majority: boolean): string {
  return majority ? `Majority reached, deciding in ${seconds}s` : `Auto-picks in ${seconds}s`;
}

/** Hearts as icons (compact count when there are many). */
export function heartsEl(hearts: number, max: number): HTMLElement {
  const el = h('span', { class: 'hop-hearts', title: `${hearts} / ${max} hearts` });
  if (max <= 12)
    for (let i = 0; i < max; i++)
      el.append(h('i', { class: i < hearts ? 'on' : '' }, i < hearts ? '❤' : '♡'));
  else el.append(h('i', { class: 'on' }, '❤'), ` ${hearts}/${max}`);
  return el;
}

export function trinketChip(id: keyof typeof TRINKETS, big = false, level = 1): HTMLElement {
  const t = TRINKETS[id];
  const lv = Math.max(1, Math.min(3, level));
  return h(
    'span',
    {
      class: `trinket ${big ? 'big' : ''} ${t.rare ? 'rare' : ''} ${lv > 1 ? `lv${lv}` : ''}`,
      title: `${t.name}${lv > 1 ? ` Lv${lv}` : ''} — ${t.levels[lv - 1]}`,
    },
    t.icon,
    lv > 1 ? h('b', { class: 'tlv' }, String(lv)) : null,
  );
}

/** Card content for one fork route or trinket option. */
export function optionCard(o: ChoiceOption): (HTMLElement | null)[] {
  if (o.trinket) {
    const t = TRINKETS[o.trinket];
    const lv = o.level ?? 1;
    return [
      lv > 1 ? h('div', { class: 'oc-levelup' }, `⬆️ Level up → Lv${lv}`) : null,
      h('div', { class: 'oc-icon' }, t.icon),
      h(
        'div',
        { class: 'oc-name' },
        t.name,
        lv > 1 ? ` Lv${lv}` : null,
        t.rare && lv === 1 ? h('small', { class: 'rare-tag' }, ' RARE') : null,
      ),
      h('div', { class: 'oc-desc' }, t.levels[lv - 1]),
      h(
        'div',
        { class: 'oc-pips', title: `Level ${lv} of 3` },
        ...[1, 2, 3].map((k) => h('i', { class: k <= lv ? 'on' : '' })),
      ),
    ];
  }
  const rw = o.reward ? REWARDS[o.reward] : null;
  const om = o.omen ? OMENS[o.omen] : null;
  return [
    h('div', { class: 'oc-icon' }, rw?.icon ?? '⛳'),
    h('div', { class: 'oc-name' }, rw?.name ?? 'Plain route'),
    h('div', { class: 'oc-desc' }, rw?.desc ?? ''),
    h(
      'div',
      { class: `oc-omen ${om ? 'bad' : 'clear'}` },
      om ? `${om.icon} ${om.name}: ${om.desc}` : '☀️ Clear skies',
    ),
    o.name ? h('div', { class: 'oc-hole' }, `${o.name} · Par ${o.par}`) : null,
  ];
}

/**
 * Planet Hopper overlay: the run bar (hearts, stardust, stage, omen, trinkets), the fork /
 * trinket choice cards with co-op votes, and the wind gauge.
 */
export class HopperHud {
  readonly root: HTMLElement;
  private readonly bar: HTMLElement;
  private readonly choice: HTMLElement;
  private readonly wind: HTMLElement;
  private choiceKey = '';
  private barKey = '';
  private deadline = 0;
  private timerEl: HTMLElement | null = null;
  /** A strict majority is on one option (the host has cut the countdown). */
  private majority = false;
  private readonly timer: number;

  constructor(
    parent: HTMLElement,
    private readonly cb: { vote(i: number): void; reroll(): void },
  ) {
    this.bar = h('div', { class: 'hop-bar panel' });
    this.choice = h('div', { class: 'hop-choice hidden' });
    this.wind = h(
      'div',
      { class: 'hop-wind hidden', title: 'Wind' },
      h('div', { class: 'arrow' }, '➤'),
      h('small', {}, 'wind'),
    );
    this.root = h('div', { class: 'hop-layer' }, this.bar, this.wind, this.choice);
    parent.append(this.root);
    this.timer = window.setInterval(() => this.renderTimer(), 250);
  }

  /** Countdown text, from the host's (authoritative) seconds left. */
  private renderTimer(): void {
    if (!this.timerEl || !this.deadline) return;
    const s = Math.max(0, Math.ceil((this.deadline - performance.now()) / 1000));
    this.timerEl.textContent = choiceTimerText(s, this.majority);
    this.timerEl.classList.toggle('hop-majority', this.majority);
  }

  update(score: ScoreState, players: SessionPlayer[], myId: string): void {
    const hs = score.hopper;
    if (!hs) return;
    this.renderBar(hs);
    this.renderChoice(hs, players, myId);
  }

  private renderBar(hs: HopperState): void {
    const spec = hs.stages[hs.stage];
    const key = JSON.stringify([
      hs.hearts,
      hs.maxHearts,
      hs.dust,
      hs.trinkets,
      hs.levels,
      hs.stage,
      hs.rerolls,
      hs.secondWind,
    ]);
    if (key === this.barKey) return;
    const heartsChanged = this.barKey !== '' && JSON.parse(this.barKey)[0] !== hs.hearts;
    this.barKey = key;
    clear(this.bar);
    const kind =
      spec?.kind === 'boss' ? '☠️ Boss' : spec?.kind === 'rest' ? '🌿 Rest stop' : `Stage ${hs.stage + 1}`;
    const omen = spec?.omen ? OMENS[spec.omen] : null;
    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'hop-row' },
        heartsEl(hs.hearts, hs.maxHearts),
        h('span', { class: 'hop-dust', title: 'Stardust (banked at the end of the run)' }, `✨ ${hs.dust}`),
        hs.rerolls > 0 ? h('span', { class: 'hop-small', title: 'Rerolls left' }, `🎲 ${hs.rerolls}`) : null,
        hs.secondWind ? h('span', { class: 'hop-small', title: 'Second Wind ready' }, '🔥') : null,
      ),
      h(
        'div',
        { class: 'hop-row hop-meta' },
        h(
          'span',
          {},
          `${WORLD_LABEL[spec?.world ?? 'meadow'] ?? ''} · Sector ${(spec?.sector ?? 0) + 1}/4 · ${kind} of ${SKELETON.length}`,
        ),
      ),
      omen
        ? h('div', { class: 'hop-omen', title: omen.desc }, `${omen.icon} ${omen.name} — ${omen.desc}`)
        : null,
      hs.trinkets.length
        ? h('div', { class: 'hop-trinkets' }, ...hs.trinkets.map((t) => trinketChip(t, false, hs.levels?.[t] ?? 1)))
        : null,
    ];
    this.bar.append(...parts.filter((x): x is HTMLElement => x !== null));
    if (heartsChanged) pulse(this.bar, 'pop');
  }

  private renderChoice(hs: HopperState, players: SessionPlayer[], myId: string): void {
    const c = hs.choice;
    if (!c) {
      this.choice.classList.add('hidden');
      this.choiceKey = '';
      this.timerEl = null;
      return;
    }
    const key = JSON.stringify([c.kind, c.options, c.votes, hs.rerolls, c.majority]);
    if (c.secondsLeft >= 0) this.deadline = performance.now() + c.secondsLeft * 1000;
    this.majority = c.majority !== undefined && c.secondsLeft >= 0;
    if (key === this.choiceKey) return;
    const fresh = this.choiceKey === '';
    this.choiceKey = key;
    clear(this.choice);
    const nameOf = (id: string) => players.find((p) => p.id === id)?.name ?? '?';
    const mine = c.votes[myId];
    const multi = players.length > 1;
    const cards = c.options.map((o, i) => {
      const voters = Object.entries(c.votes)
        .filter(([, v]) => v === i)
        .map(([id]) => id);
      return h(
        'button',
        {
          class: `hop-card k-${c.kind} ${mine === i ? 'picked' : ''} ${o.omen ? 'omened' : ''}`,
          onclick: () => this.cb.vote(i),
        },
        ...optionCard(o),
        multi && voters.length
          ? h(
              'div',
              { class: 'oc-votes' },
              ...voters.map((v) => h('span', {}, v === myId ? 'You' : nameOf(v))),
            )
          : null,
      );
    });
    this.timerEl = c.secondsLeft >= 0 ? h('span', { class: 'muted' }) : null;
    this.choice.append(
      h('div', { class: 'hop-choice-title' }, c.kind === 'route' ? '🔀 ' : '🎁 ', c.title),
      h(
        'div',
        { class: 'hop-choice-sub' },
        c.kind === 'route'
          ? multi
            ? 'Vote for the next hole: its reward is paid when you clear it.'
            : 'Pick the next hole: its reward is paid when you clear it.'
          : multi
            ? 'Vote for a trinket for the team — it lasts the whole run.'
            : 'Pick a trinket — it lasts the whole run.',
      ),
      h('div', { class: `hop-cards n${c.options.length}` }, ...cards),
      h(
        'div',
        { class: 'hop-choice-foot' },
        this.timerEl,
        hs.rerolls > 0
          ? h('button', { class: 'btn small', onclick: () => this.cb.reroll() }, `🎲 Reroll (${hs.rerolls})`)
          : null,
      ),
    );
    this.choice.classList.remove('hidden');
    this.renderTimer();
    if (fresh) pulse(this.choice, 'pop');
  }

  /** Wind gauge: angle in screen space (radians, 0 = right), or null to hide. */
  setWind(angle: number | null, strength = 0): void {
    this.wind.classList.toggle('hidden', angle === null);
    if (angle === null) return;
    const arrow = this.wind.firstElementChild as HTMLElement;
    arrow.style.transform = `rotate(${angle}rad) scale(${0.8 + strength * 0.5})`;
  }

  get choosing(): boolean {
    return this.choiceKey !== '';
  }

  dispose(): void {
    clearInterval(this.timer);
    this.root.remove();
  }
}
