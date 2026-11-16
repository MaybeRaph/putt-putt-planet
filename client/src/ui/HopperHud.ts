import {
  COMBOS,
  OMENS,
  POWERUPS,
  POWERUP_IDS,
  PRESTIGE,
  REWARDS,
  SKELETON,
  TRINKETS,
  activeCombos,
  isCurse,
  maxLevelOf,
  sellPrice,
  type ChoiceOption,
  type HopperState,
  type ScoreState,
  type TrinketId,
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
  const lv = Math.max(1, Math.min(maxLevelOf(id), level));
  return h(
    'span',
    {
      class: `trinket ${big ? 'big' : ''} ${t.rare ? 'rare' : ''} ${t.curse ? 'cursed' : ''} ${lv > 1 ? `lv${lv}` : ''}`,
      title: `${t.curse ? 'Cursed: ' : ''}${t.name}${lv > 1 ? ` Lv${lv}` : ''} — ${t.levels[lv - 1]}`,
    },
    t.icon,
    lv > 1 ? h('b', { class: 'tlv' }, String(lv)) : null,
  );
}

/** Combo chips for the run bar and results. */
export function comboChip(id: keyof typeof COMBOS): HTMLElement {
  const c = COMBOS[id];
  return h(
    'span',
    {
      class: 'combo-chip',
      title: `${c.name} (${TRINKETS[c.needs[0]].icon} + ${TRINKETS[c.needs[1]].icon}) — ${c.desc}`,
    },
    c.icon,
  );
}

/** Card content for one fork route or trinket option. */
export function optionCard(o: ChoiceOption, hs?: HopperState): (HTMLElement | null)[] {
  if (o.action) {
    const next = (hs?.prestige ?? 0) + 1;
    return o.action === 'prestige'
      ? [
          h('div', { class: 'oc-icon' }, '🌟'),
          h('div', { class: 'oc-name' }, `Prestige ${next}`),
          h(
            'div',
            { class: 'oc-desc' },
            `Keep the run going: another ${SKELETON.length} stages, a little harder each lap, with more cases, coins and rare trinkets. Hearts and trinkets carry on (+${PRESTIGE.heal} ❤️).`,
          ),
          h('div', { class: 'oc-omen bad' }, '☠️ Lose and the run ends (your stardust is still banked)'),
        ]
      : [
          h('div', { class: 'oc-icon' }, '🏁'),
          h('div', { class: 'oc-name' }, 'Cash out'),
          h('div', { class: 'oc-desc' }, 'End the run here as a win and bank everything.'),
          h('div', { class: 'oc-omen clear' }, '✅ Safe'),
        ];
  }
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
        t.curse ? h('small', { class: 'curse-tag' }, ' CURSED') : null,
        t.rare && lv === 1 ? h('small', { class: 'rare-tag' }, ' RARE') : null,
      ),
      h('div', { class: 'oc-desc' }, t.levels[lv - 1]),
      t.curse
        ? null
        : h(
            'div',
            { class: 'oc-pips', title: `Level ${lv} of 3` },
            ...[1, 2, 3].map((k) => h('i', { class: k <= lv ? 'on' : '' })),
          ),
      ...comboHints(o.trinket, hs),
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

/** "Combo with 🧲!" hints on a trinket card that would complete a pair the team half has. */
function comboHints(t: TrinketId, hs?: HopperState): HTMLElement[] {
  if (!hs) return [];
  return Object.values(COMBOS)
    .filter((c) => c.needs.includes(t) && !hs.trinkets.includes(t))
    .filter((c) => c.needs.every((x) => x === t || hs.trinkets.includes(x)))
    .map((c) => h('div', { class: 'oc-combo' }, `${c.icon} Combo: ${c.name}!`));
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
  private readonly shopBtn: HTMLButtonElement;
  private readonly shopPanel: HTMLElement;
  private shopKey = '';
  private lastHs: HopperState | null = null;
  private choiceKey = '';
  private barKey = '';
  private deadline = 0;
  private timerEl: HTMLElement | null = null;
  /** A strict majority is on one option (the host has cut the countdown). */
  private majority = false;
  private readonly timer: number;

  constructor(
    parent: HTMLElement,
    private readonly cb: {
      vote(i: number): void;
      reroll(): void;
      shop(action: 'buy' | 'sell', item: string): void;
    },
  ) {
    this.bar = h('div', { class: 'hop-bar panel' });
    this.shopPanel = h('div', { class: 'hop-shop panel hidden' });
    this.shopBtn = h(
      'button',
      { class: 'btn hop-shop-btn hidden', onclick: () => this.toggleShop() },
      '🛒 Shop',
    );
    this.choice = h('div', { class: 'hop-choice hidden' });
    this.wind = h(
      'div',
      { class: 'hop-wind hidden', title: 'Wind' },
      h('div', { class: 'arrow' }, '➤'),
      h('small', {}, 'wind'),
    );
    this.root = h(
      'div',
      { class: 'hop-layer' },
      this.bar,
      this.wind,
      this.shopBtn,
      this.shopPanel,
      this.choice,
    );
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
    this.lastHs = hs;
    this.renderBar(hs);
    this.renderChoice(hs, players, myId);
    this.renderShop(hs);
  }

  /** Rest-stop shop: open/close the panel. */
  toggleShop(open = this.shopPanel.classList.contains('hidden')): void {
    this.shopPanel.classList.toggle('hidden', !open);
    if (open) {
      this.shopKey = '';
      if (this.lastHs) this.renderShop(this.lastHs);
      pulse(this.shopPanel, 'pop');
    }
  }

  get shopVisible(): boolean {
    return !this.shopPanel.classList.contains('hidden');
  }

  private renderShop(hs: HopperState): void {
    const spec = hs.stages[hs.stage];
    const open = spec?.kind === 'rest' && hs.result === 'running';
    this.shopBtn.classList.toggle('hidden', !open);
    this.shopBtn.textContent = `🛒 Shop · 🪙 ${hs.coins}`;
    if (!open) {
      this.shopPanel.classList.add('hidden');
      return;
    }
    if (this.shopPanel.classList.contains('hidden')) return;
    const key = JSON.stringify([hs.coins, hs.boosts, hs.trinkets, hs.levels, hs.rerolls, hs.hearts]);
    if (key === this.shopKey) return;
    this.shopKey = key;
    clear(this.shopPanel);
    const buy = POWERUP_IDS.map((id) => {
      const p = POWERUPS[id];
      const waiting = hs.boosts.includes(id);
      return h(
        'button',
        {
          class: `shop-item ${waiting ? 'owned' : ''}`,
          disabled: waiting || hs.coins < p.price,
          title: p.desc,
          onclick: () => this.cb.shop('buy', id),
        },
        h('span', { class: 'si-icon' }, p.icon),
        h('span', { class: 'si-name' }, p.name),
        h('span', { class: 'si-desc' }, p.desc),
        h('span', { class: 'si-price' }, waiting ? '✓ Ready' : `🪙 ${p.price}`),
      );
    });
    const sell = hs.trinkets.map((t) => {
      const lv = hs.levels?.[t] ?? 1;
      return h(
        'button',
        {
          class: `shop-item sell ${isCurse(t) ? 'cursed' : ''}`,
          title: `Sell ${TRINKETS[t].name}${isCurse(t) ? ' (gets rid of the curse)' : ''}`,
          onclick: () => this.cb.shop('sell', t),
        },
        trinketChip(t, true, lv),
        h('span', { class: 'si-name' }, TRINKETS[t].name, lv > 1 ? ` Lv${lv}` : ''),
        h('span', { class: 'si-price' }, `+🪙 ${sellPrice(t, lv)}`),
      );
    });
    this.shopPanel.append(
      h(
        'div',
        { class: 'shop-head' },
        h('b', {}, '🛒 Rest-stop shop'),
        h('span', { class: 'shop-coins' }, `🪙 ${hs.coins}`),
        h('button', { class: 'btn small', onclick: () => this.toggleShop(false) }, '✕'),
      ),
      h(
        'div',
        { class: 'shop-sub' },
        'Coins you picked up this run. Powerups work once; the team shares the wallet.',
      ),
      h('div', { class: 'shop-grid' }, ...buy),
    );
    if (sell.length)
      this.shopPanel.append(
        h('div', { class: 'shop-sub' }, 'Sell a trinket (curses too):'),
        h('div', { class: 'shop-grid sell' }, ...sell),
      );
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
      hs.coins,
      hs.prestige,
      hs.boosts,
    ]);
    if (key === this.barKey) return;
    const heartsChanged = this.barKey !== '' && JSON.parse(this.barKey)[0] !== hs.hearts;
    this.barKey = key;
    clear(this.bar);
    const pos = (hs.stage % SKELETON.length) + 1;
    const kind = spec?.kind === 'boss' ? '☠️ Boss' : spec?.kind === 'rest' ? '🌿 Rest stop' : `Stage ${pos}`;
    const combos = activeCombos(hs.trinkets);
    const omen = spec?.omen ? OMENS[spec.omen] : null;
    const parts: (HTMLElement | null)[] = [
      h(
        'div',
        { class: 'hop-row' },
        heartsEl(hs.hearts, hs.maxHearts),
        h('span', { class: 'hop-dust', title: 'Stardust (banked at the end of the run)' }, `✨ ${hs.dust}`),
        h('span', { class: 'hop-coins', title: 'Shop coins (spend them at rest stops)' }, `🪙 ${hs.coins}`),
        hs.rerolls > 0 ? h('span', { class: 'hop-small', title: 'Rerolls left' }, `🎲 ${hs.rerolls}`) : null,
        hs.secondWind ? h('span', { class: 'hop-small', title: 'Second Wind ready' }, '🔥') : null,
        hs.prestige > 0
          ? h(
              'span',
              { class: 'hop-prestige', title: `Prestige ${hs.prestige}: harder holes, richer loot` },
              `🌟${hs.prestige}`,
            )
          : null,
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
      spec?.boosts?.length
        ? h(
            'div',
            { class: 'hop-boosts' },
            ...spec.boosts.map((b) =>
              h('span', { title: POWERUPS[b].desc }, `${POWERUPS[b].icon} ${POWERUPS[b].name}`),
            ),
          )
        : null,
      omen
        ? h('div', { class: 'hop-omen', title: omen.desc }, `${omen.icon} ${omen.name} — ${omen.desc}`)
        : null,
      hs.trinkets.length
        ? h(
            'div',
            { class: 'hop-trinkets' },
            ...hs.trinkets.map((t) => trinketChip(t, false, hs.levels?.[t] ?? 1)),
            ...combos.map((c) => comboChip(c)),
          )
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
        ...optionCard(o, hs),
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
      h(
        'div',
        { class: 'hop-choice-title' },
        c.kind === 'route' ? '🔀 ' : c.kind === 'prestige' ? '🏆 ' : '🎁 ',
        c.title,
      ),
      h(
        'div',
        { class: 'hop-choice-sub' },
        c.kind === 'prestige'
          ? multi
            ? 'Vote: go round again for prestige, or cash out with the win.'
            : 'Go round again for prestige, or cash out with the win?'
          : c.kind === 'route'
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
        hs.rerolls > 0 && c.kind !== 'prestige'
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
