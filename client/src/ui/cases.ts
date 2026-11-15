import {
  CASES,
  CASE_IDS,
  COSMETIC_BY_ID,
  RARITIES,
  RARITY_INFO,
  caseOdds,
  caseSkins,
  caseStock,
  dustBalance,
  isOwned,
  pickCaseSkin,
  type CaseId,
  type CaseOpening,
  type Cosmetic,
  type CosmeticSlot,
} from '@ppp/shared';
import type { Game } from '../core/Game';
import { audio } from '../audio/Audio';
import { skinTexture } from '../rendering/BallView';
import { h, clear } from './dom';
import { LockerPreview } from './LockerPreview';

/**
 * v1.11 Cases: the cases you have found on Planet Hopper holes, keys bought with stardust,
 * and the opening reel.
 */

const rarityOf = (c: Cosmetic) => c.rarity ?? 'common';

/** A case drawn as a little briefcase in its planet's colours. */
export function caseArt(id: CaseId, size: 'small' | 'big' = 'small'): HTMLElement {
  const d = CASES[id];
  return h(
    'div',
    {
      class: `case-art ${size}`,
      style: `--c1:${d.color};--c2:${d.color2};--rc:${RARITY_INFO[d.rarity].color}`,
    },
    h('i', { class: 'case-handle' }),
    h('i', { class: 'case-band' }),
    h('span', { class: 'case-icon' }, d.icon),
  );
}

/** A skin thumbnail drawn with the same textures as the game (balls), or a sketch (trail, putter). */
export function skinSwatch(c: Cosmetic, px = 64): HTMLElement {
  const cv = document.createElement('canvas');
  const s = px * 2;
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d')!;
  const a = c.color,
    b = c.color2 ?? '#ffffff';
  if (c.slot === 'ball') {
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, 7);
    ctx.clip();
    const tex = skinTexture(c.id);
    const img = tex?.image as CanvasImageSource | undefined;
    if (img) ctx.drawImage(img, -s * 0.1, 0, s * 1.2, s);
    else {
      ctx.fillStyle = a;
      ctx.fillRect(0, 0, s, s);
    }
    // Light from the top left, a soft shadow bottom right.
    const shade = ctx.createRadialGradient(s * 0.36, s * 0.32, s * 0.05, s / 2, s / 2, s * 0.46);
    shade.addColorStop(0, c.fx === 'metal' ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.45)');
    shade.addColorStop(0.45, 'rgba(255,255,255,0)');
    shade.addColorStop(1, 'rgba(20,10,60,0.4)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    ctx.lineWidth = s * 0.035;
    ctx.strokeStyle = '#2a1f5c';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.42, 0, 7);
    ctx.stroke();
  } else if (c.slot === 'trail') {
    const g = ctx.createLinearGradient(s * 0.1, 0, s * 0.9, 0);
    g.addColorStop(0, `${b}00`);
    g.addColorStop(0.5, b);
    g.addColorStop(1, a);
    ctx.strokeStyle = g;
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = s * (0.16 - i * 0.04);
      ctx.beginPath();
      ctx.moveTo(s * 0.1, s * (0.7 - i * 0.02));
      ctx.bezierCurveTo(s * 0.35, s * 0.25, s * 0.6, s * 0.85, s * 0.85, s * 0.4);
      ctx.stroke();
    }
    ctx.fillStyle = a;
    ctx.strokeStyle = '#2a1f5c';
    ctx.lineWidth = s * 0.03;
    ctx.beginPath();
    ctx.arc(s * 0.85, s * 0.4, s * 0.11, 0, 7);
    ctx.fill();
    ctx.stroke();
  } else {
    // Putter: shaft, grip and head.
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2a1f5c';
    ctx.lineWidth = s * 0.075;
    ctx.beginPath();
    ctx.moveTo(s * 0.7, s * 0.12);
    ctx.lineTo(s * 0.42, s * 0.74);
    ctx.stroke();
    ctx.strokeStyle = '#eceff1';
    ctx.lineWidth = s * 0.045;
    ctx.stroke();
    ctx.strokeStyle = b;
    ctx.lineWidth = s * 0.08;
    ctx.beginPath();
    ctx.moveTo(s * 0.72, s * 0.08);
    ctx.lineTo(s * 0.64, s * 0.26);
    ctx.stroke();
    ctx.fillStyle = a;
    ctx.strokeStyle = '#2a1f5c';
    ctx.lineWidth = s * 0.035;
    ctx.beginPath();
    ctx.roundRect(s * 0.18, s * 0.68, s * 0.42, s * 0.16, s * 0.05);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = b;
    ctx.fillRect(s * 0.24, s * 0.73, s * 0.3, s * 0.04);
  }
  return h(
    'div',
    {
      class: `skin-swatch r-${rarityOf(c)} ${c.fx ? `fx-${c.fx}` : ''}`,
      style: `--rc:${RARITY_INFO[rarityOf(c)].color};--px:${px}px`,
    },
    cv,
  );
}

const SLOT_WORD: Partial<Record<CosmeticSlot, string>> = { ball: 'Ball', trail: 'Trail', putter: 'Putter' };
const pct = (x: number) => (x >= 0.1 ? `${(x * 100).toFixed(0)}%` : `${(x * 100).toFixed(1)}%`);

export function casesScreen(
  g: Game,
  header: (title: string, back: () => void) => HTMLElement,
  back: () => void,
  start?: CaseId,
): void {
  let sel: CaseId = start ?? CASE_IDS.find((id) => caseStock(g.profile.profile, id).cases > 0) ?? 'meadow';
  const list = h('div', { class: 'case-list' });
  const detail = h('div', { class: 'panel case-detail' });
  const dustEl = h('div', { class: 'cases-dust' });

  const render = () => {
    const p = g.profile.profile;
    dustEl.textContent = `✨ ${dustBalance(p.hopper)} stardust`;
    // The header's profile chip too (keys and refunds change the balance).
    document.querySelectorAll('.pc-dust').forEach((el) => (el.textContent = `✨ ${dustBalance(p.hopper)}`));
    clear(list);
    CASE_IDS.forEach((id, i) => {
      const d = CASES[id];
      const st = caseStock(p, id);
      list.append(
        h(
          'button',
          {
            class: `case-card ${id === sel ? 'selected' : ''} ${st.cases ? 'has' : ''}`,
            style: `--i:${i};--rc:${RARITY_INFO[d.rarity].color}`,
            onclick: () => {
              sel = id;
              render();
            },
          },
          caseArt(id),
          h(
            'div',
            { class: 'case-card-text' },
            h('b', {}, d.name),
            h(
              'span',
              { class: 'rarity-tag', style: `--rc:${RARITY_INFO[d.rarity].color}` },
              RARITY_INFO[d.rarity].label,
            ),
            h('small', {}, `💼 ${st.cases}  ·  🔑 ${st.keys}`),
          ),
        ),
      );
    });

    clear(detail);
    const d = CASES[sel];
    const st = caseStock(p, sel);
    const dust = dustBalance(p.hopper);
    const odds = caseOdds(sel);
    const skins = caseSkins(sel);
    const owned = skins.filter((s) => isOwned(p, s.id)).length;
    detail.append(
      h(
        'div',
        { class: 'case-hero' },
        caseArt(sel, 'big'),
        h(
          'div',
          { class: 'case-hero-text' },
          h('h3', {}, `${d.icon} ${d.name}`),
          h(
            'span',
            { class: 'rarity-tag', style: `--rc:${RARITY_INFO[d.rarity].color}` },
            `${RARITY_INFO[d.rarity].label} case`,
          ),
          h(
            'div',
            { class: 'case-stock' },
            h('span', {}, `💼 ${st.cases} to open`),
            h('span', {}, `🔑 ${st.keys} key${st.keys === 1 ? '' : 's'}`),
          ),
          h(
            'div',
            { class: 'row case-actions' },
            h(
              'button',
              {
                class: 'btn',
                disabled: dust < d.keyPrice,
                title:
                  dust < d.keyPrice
                    ? 'Earn stardust on Planet Hopper runs'
                    : `Buy a key for ${d.keyPrice} stardust`,
                onclick: () => {
                  const err = g.profile.buyCaseKey(sel);
                  if (err) return g.ui.toast(err, 'bad');
                  audio.ui('buy');
                  g.ui.toast(`🔑 Bought a ${d.name} key`, 'good');
                  render();
                },
              },
              `🔑 Buy key · ✨ ${d.keyPrice}`,
            ),
            h(
              'button',
              {
                class: 'btn primary',
                disabled: !st.cases || !st.keys,
                onclick: () => {
                  const r = g.profile.openCase(sel);
                  if (typeof r === 'string') return g.ui.toast(r, 'bad');
                  rollReel(g, sel, r, () => {
                    render();
                  });
                },
              },
              '💼 Open case',
            ),
          ),
          !st.cases
            ? h(
                'p',
                { class: 'muted small' },
                `Find ${d.name}s hidden on ${d.icon} Planet Hopper holes. Anyone in the run who reaches one gets one for everybody.`,
              )
            : !st.keys
              ? h(
                  'p',
                  { class: 'muted small' },
                  'You need a key to open it. Keys cost stardust, earned on Planet Hopper runs.',
                )
              : null,
        ),
      ),
      h(
        'div',
        { class: 'odds-row' },
        ...RARITIES.filter((r) => odds[r] > 0).map((r) =>
          h(
            'span',
            { class: 'odds-chip', style: `--rc:${RARITY_INFO[r].color}` },
            h('b', {}, RARITY_INFO[r].label),
            ` ${pct(odds[r])}`,
          ),
        ),
      ),
      h(
        'div',
        { class: 'case-contents-head' },
        h('b', {}, 'Contents'),
        h('span', { class: 'muted small' }, `${owned}/${skins.length} collected · only in this case`),
      ),
      h(
        'div',
        { class: 'case-contents' },
        ...[...skins]
          .reverse()
          .map((s) =>
            h(
              'div',
              {
                class: `case-skin r-${rarityOf(s)} ${isOwned(p, s.id) ? 'owned' : ''}`,
                style: `--rc:${RARITY_INFO[rarityOf(s)].color}`,
              },
              skinSwatch(s, 46),
              h('div', { class: 'cs-name' }, s.name),
              h('div', { class: 'cs-sub' }, `${RARITY_INFO[rarityOf(s)].label} ${SLOT_WORD[s.slot] ?? ''}`),
              isOwned(p, s.id) ? h('i', { class: 'cs-owned', title: 'Owned' }, '✓') : null,
            ),
          ),
      ),
    );
  };
  render();
  g.ui.showScreen(
    h(
      'div',
      { class: 'screen cases-screen' },
      header('Cases', back),
      h(
        'div',
        { class: 'cases-top' },
        dustEl,
        h(
          'span',
          { class: 'muted small' },
          'Cases hide on Planet Hopper holes. Open them with a key to win skins found nowhere else.',
        ),
      ),
      h('div', { class: 'cases-layout' }, list, detail),
    ),
  );
}

/** Reel card for one skin. */
function reelCard(s: Cosmetic): HTMLElement {
  return h(
    'div',
    { class: `reel-card r-${rarityOf(s)}`, style: `--rc:${RARITY_INFO[rarityOf(s)].color}` },
    skinSwatch(s, 50),
    h('div', { class: 'rc-name' }, s.name),
  );
}

/**
 * The opening: a strip of the case's skins (common ones most of the time, as the odds go) slides
 * under a marker, slowing to land on the drop, ticking as each one passes; then the reveal.
 */
function rollReel(g: Game, id: CaseId, r: CaseOpening, done: () => void): void {
  const d = CASES[id];
  const reduced = g.settings.reducedMotion;
  const CARD = 132; // card width + gap, px (matches .reel-card in styles.css)
  const WIN = 52;
  const cards: Cosmetic[] = [];
  for (let i = 0; i < WIN + 6; i++)
    cards.push(i === WIN ? r.skin : pickCaseSkin(id, Math.random(), Math.random()));
  // A near miss now and then: something rarer than the drop sits right next to it.
  if (Math.random() < 0.5) {
    const better = caseSkins(id).filter(
      (s) => RARITIES.indexOf(rarityOf(s)) > RARITIES.indexOf(rarityOf(r.skin)),
    );
    if (better.length)
      cards[WIN + (Math.random() < 0.5 ? 1 : -1)] = better[Math.floor(Math.random() * better.length)];
  }
  const strip = h('div', { class: 'reel-strip' }, ...cards.map(reelCard));
  const viewport = h('div', { class: 'reel-viewport' }, strip, h('i', { class: 'reel-marker' }));
  const skipBtn = h('button', { class: 'btn small' }, 'Skip ⏩');
  const box = h(
    'div',
    { class: 'modal case-open', style: `--c1:${d.color};--c2:${d.color2}` },
    h('h2', { class: 'center' }, `${d.icon} Opening ${d.name}`),
    viewport,
    h('div', { class: 'row center' }, skipBtn),
  );
  g.ui.showOverlay(box);
  audio.ui('click');

  const dur = reduced ? 1200 : 6200;
  // Land somewhere inside the winning card, not dead centre.
  const jitter = (Math.random() - 0.5) * (CARD - 30);
  let target = 0;
  let t0 = 0;
  let lastIndex = -1;
  let finished = false;
  const ease = (x: number) => 1 - Math.pow(1 - x, 4.2);
  const step = (now: number) => {
    if (finished) return;
    if (!t0) {
      t0 = now;
      target = WIN * CARD + CARD / 2 - viewport.clientWidth / 2 + jitter;
    }
    const k = Math.min(1, (now - t0) / dur);
    const x = target * ease(k);
    strip.style.transform = `translateX(${-x}px)`;
    const idx = Math.floor((x + viewport.clientWidth / 2) / CARD);
    if (idx !== lastIndex) {
      lastIndex = idx;
      if (k < 1) audio.caseTick(1 + (1 - k) * 0.3);
    }
    if (k < 1) requestAnimationFrame(step);
    else land();
  };
  const land = () => {
    if (finished) return;
    finished = true;
    strip.style.transform = `translateX(${-target}px)`;
    strip.children[WIN]?.classList.add('winner');
    setTimeout(() => reveal(g, id, r, done), reduced ? 250 : 900);
  };
  skipBtn.onclick = () => {
    if (!t0) target = WIN * CARD + CARD / 2 - viewport.clientWidth / 2 + jitter;
    land();
  };
  requestAnimationFrame(step);
}

function reveal(g: Game, id: CaseId, r: CaseOpening, done: () => void): void {
  const s = r.skin;
  const rar = rarityOf(s);
  const info = RARITY_INFO[rar];
  const top = rar === 'mythic' || rar === 'legendary';
  const preview = new LockerPreview();
  const loadout = g.profile.loadout();
  preview.setLoadout({ ...loadout, [s.slot]: s.id });
  preview.focus(s.slot);
  preview.play(s.slot, s.id);
  const close = () => {
    preview.dispose();
    g.ui.showOverlay(null);
    done();
  };
  const st = caseStock(g.profile.profile, id);
  const box = h(
    'div',
    { class: `modal case-reveal r-${rar}`, style: `--rc:${info.color}` },
    rar === 'mythic' ? h('div', { class: 'mythic-rays' }) : null,
    h('div', { class: 'reveal-rarity' }, info.label),
    h('div', { class: 'reveal-stage' }, preview.canvas),
    h('h2', { class: 'center reveal-name' }, s.name),
    h('div', { class: 'center muted' }, `${SLOT_WORD[s.slot] ?? ''} · ${CASES[id].name}`),
    r.duplicate
      ? h('div', { class: 'reveal-dup' }, `Already yours: +${r.refund} ✨ stardust`)
      : h('div', { class: 'reveal-new' }, '✨ NEW! ✨'),
    h(
      'div',
      { class: 'row center' },
      !r.duplicate && (s.slot === 'ball' || s.slot === 'trail' || s.slot === 'putter')
        ? h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                g.profile.equip(s.slot, s.id);
                g.ui.toast(`Equipped ${s.name}`, 'good');
                close();
              },
            },
            'Equip',
          )
        : null,
      st.cases && st.keys
        ? h(
            'button',
            {
              class: 'btn',
              onclick: () => {
                preview.dispose();
                const again = g.profile.openCase(id);
                if (typeof again === 'string') return close();
                rollReel(g, id, again, done);
              },
            },
            'Open another',
          )
        : null,
      h('button', { class: 'btn', onclick: close }, 'Done'),
    ),
  );
  g.ui.showOverlay(box);
  if (top) audio.fanfare(true);
  else if (rar === 'epic') audio.fanfare(false);
  else audio.ui('buy');
  if (rar === 'mythic' && !g.settings.reducedMotion) document.body.classList.add('mythic-shake');
  setTimeout(() => document.body.classList.remove('mythic-shake'), 700);
}

/** Owned case skins count, for the menu button. */
export function casesToOpen(g: Game): number {
  return CASE_IDS.reduce((n, id) => n + caseStock(g.profile.profile, id).cases, 0);
}

export const isCaseSkin = (id: string) => COSMETIC_BY_ID.get(id)?.unlock.type === 'case';
