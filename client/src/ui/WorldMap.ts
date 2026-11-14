import type { Course } from '@ppp/shared';

/**
 * Play Solo course select as an overworld map: each world is a low-poly island, its holes are
 * stepping stones along a winding path, and dotted bridges join the islands in play order.
 * A ball marker (your equipped skin colour) hops to whichever world is selected.
 *
 * Layout is pure (`mapLayout`, `islandOutline`) so it is testable; `WorldMap` turns it into SVG.
 * Two arrangements: `wide` (islands left to right, desktop) and `tall` (top to bottom, phones).
 */

export type MapMode = 'wide' | 'tall';
export interface Pt {
  x: number;
  y: number;
}
export interface IslandLayout {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** One stepping stone per hole, in play order, evenly spaced along the island's path. */
  nodes: Pt[];
  /** Where the world badge sits (a spot the path stays clear of). */
  badge: Pt;
}
export interface MapLayout {
  mode: MapMode;
  w: number;
  h: number;
  islands: IslandLayout[];
}

export const NODE_R = 17;
const WIDE = { w: 1660, h: 600, step: 320, x0: 190, yA: 215, yB: 372, rx: 150, ry: 118 };
const TALL = { w: 420, step: 372, y0: 195, xA: 150, xB: 270, rx: 150, ry: 168 };

export function mapLayout(mode: MapMode, holeCounts: number[]): MapLayout {
  const n = holeCounts.length;
  const islands = holeCounts.map((count, i): IslandLayout => {
    const wide = mode === 'wide';
    const cx = wide ? WIDE.x0 + i * WIDE.step : i % 2 ? TALL.xB : TALL.xA;
    const cy = wide ? (i % 2 ? WIDE.yB : WIDE.yA) : TALL.y0 + i * TALL.step;
    const rx = wide ? WIDE.rx : TALL.rx;
    const ry = wide ? WIDE.ry : TALL.ry;
    // Local frame: u runs along the journey, v across it. The path is an S: it enters on one
    // side, swings across the island three times and leaves on the far side.
    const u: Pt = wide ? { x: 1, y: 0 } : { x: 0, y: 1 };
    const v: Pt = { x: -u.y, y: u.x };
    const extU = Math.hypot(rx * u.x, ry * u.y);
    const extV = Math.hypot(rx * v.x, ry * v.y);
    const Lu = extU * 0.72;
    const Lv = extV * 0.6;
    const at = (t: number): Pt => {
      const a = -Math.cos(Math.PI * t) * Lu;
      const b = Math.sin(3 * Math.PI * t) * Lv;
      return { x: cx + u.x * a + v.x * b, y: cy + u.y * a + v.y * b };
    };
    return {
      cx,
      cy,
      rx,
      ry,
      nodes: spaceEvenly(at, count),
      // Wide: below the middle of the S. Tall: in the bay between the S's two left-hand bends,
      // nudged up so the name sign and stars hang down into it.
      badge: wide ? { x: cx, y: cy + extV * 0.5 } : { x: cx - extV * 0.5, y: cy - 34 },
    };
  });
  const w = mode === 'wide' ? WIDE.w : TALL.w;
  const h = mode === 'wide' ? WIDE.h : TALL.y0 + (n - 1) * TALL.step + 200;
  return { mode, w, h, islands };
}

/** `count` points at equal arc length along the curve `at(t)`, t in [0, 1]. */
function spaceEvenly(at: (t: number) => Pt, count: number): Pt[] {
  const N = 400;
  const pts: Pt[] = [];
  const len: number[] = [0];
  for (let i = 0; i <= N; i++) {
    pts.push(at(i / N));
    if (i) len.push(len[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const total = len[N];
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = count === 1 ? total / 2 : (k / (count - 1)) * total;
    while (j < N - 1 && len[j + 1] < target) j++;
    const seg = len[j + 1] - len[j] || 1;
    const f = Math.min(1, Math.max(0, (target - len[j]) / seg));
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * f, y: pts[j].y + (pts[j + 1].y - pts[j].y) * f });
  }
  return out;
}

/** A faceted island outline: an ellipse with seeded wobble, as polygon points round the centre. */
export function islandOutline(seed: number, rx: number, ry: number, sides = 17): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.sin(seed * 3.1 + i) * 0.08;
    const k =
      1 +
      0.055 * Math.sin(3 * a + seed) +
      0.04 * Math.sin(5 * a + seed * 2.3) +
      0.03 * Math.sin(i * 7.7 + seed);
    out.push({ x: Math.cos(a) * rx * k, y: Math.sin(a) * ry * k });
  }
  return out;
}

/** Smooth path through points (Catmull-Rom as cubic Béziers). */
export function smoothPath(p: Pt[]): string {
  if (p.length < 2) return '';
  let d = `M${f(p[0].x)} ${f(p[0].y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? p[i],
      p1 = p[i],
      p2 = p[i + 1],
      p3 = p[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)} ${f(c1.y)} ${f(c2.x)} ${f(c2.y)} ${f(p2.x)} ${f(p2.y)}`;
  }
  return d;
}

const f = (n: number) => n.toFixed(1);

// ------------------------------------------------------------------------------------------------
// SVG
// ------------------------------------------------------------------------------------------------

const NS = 'http://www.w3.org/2000/svg';
type SvgChild = SVGElement | string | null | false | undefined;
function s(
  tag: string,
  attrs: Record<string, string | number> = {},
  ...kids: (SvgChild | SvgChild[])[]
): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of kids.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
const poly = (pts: Pt[], dx = 0, dy = 0, k = 1) =>
  pts.map((p) => `${f(p.x * k + dx)},${f(p.y * k + dy)}`).join(' ');

const INK = '#2a1f5c';

/** Little procedural props scattered round each world's island. */
function prop(world: string, x: number, y: number, r: number, i: number): SVGElement {
  const g = s('g', {
    transform: `translate(${f(x)} ${f(y)}) scale(${(r / 14).toFixed(2)})`,
    class: 'map-prop',
  });
  const line = { stroke: INK, 'stroke-width': 2.2, 'stroke-linejoin': 'round' };
  switch (world) {
    case 'candy': {
      const c = ['#ff5fa2', '#7fe0ff', '#ffd23f'][i % 3];
      g.append(
        s('rect', { x: -1.5, y: -2, width: 3, height: 16, rx: 1.5, fill: '#fff', ...line }),
        s('circle', { cx: 0, cy: -8, r: 9, fill: c, ...line }),
        s('path', {
          d: 'M-5 -8 a5 5 0 1 1 5 5 a3 3 0 1 1 -3 -3',
          fill: 'none',
          stroke: '#fff',
          'stroke-width': 2.2,
        }),
      );
      break;
    }
    case 'frozen':
      g.append(
        s('polygon', { points: '0,-20 11,2 -11,2', fill: '#dff6ff', ...line }),
        s('polygon', { points: '0,-10 13,10 -13,10', fill: '#bfe9ff', ...line }),
        s('rect', { x: -2, y: 10, width: 4, height: 5, fill: '#8a5a3a', ...line }),
      );
      break;
    case 'clockwork': {
      const teeth: Pt[] = [];
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const rr = k % 2 ? 8 : 11;
        teeth.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr - 2 });
      }
      g.append(
        s('polygon', { points: poly(teeth), fill: i % 2 ? '#ffc94a' : '#d9a066', ...line }),
        s('circle', { cx: 0, cy: -2, r: 3.2, fill: INK }),
      );
      break;
    }
    case 'space':
      if (i % 2)
        g.append(
          s('circle', { cx: 0, cy: -4, r: 8, fill: '#ffb3e6', ...line }),
          s('ellipse', {
            cx: 0,
            cy: -4,
            rx: 14,
            ry: 4,
            fill: 'none',
            stroke: INK,
            'stroke-width': 2.2,
            transform: 'rotate(-18 0 -4)',
          }),
        );
      else
        g.append(
          s('ellipse', { cx: 0, cy: 2, rx: 10, ry: 5, fill: 'rgba(0,0,0,0.18)' }),
          s('ellipse', { cx: 0, cy: 1, rx: 6, ry: 3, fill: 'rgba(0,0,0,0.22)' }),
        );
      break;
    default:
      if (i % 3 === 2)
        g.append(
          s('line', { x1: 0, y1: 8, x2: 0, y2: -4, stroke: '#3e9f2c', 'stroke-width': 2.5 }),
          s('circle', { cx: 0, cy: -6, r: 5, fill: '#ffd23f', ...line }),
          s('circle', { cx: 0, cy: -6, r: 1.8, fill: '#c46a1a' }),
        );
      else
        g.append(
          s('rect', { x: -2, y: 2, width: 4, height: 8, fill: '#8a5a3a', ...line }),
          s('polygon', { points: '0,-18 12,4 -12,4', fill: i % 2 ? '#3fae4a' : '#4fc25a', ...line }),
        );
  }
  return g;
}

export interface WorldInfo {
  course: Course;
  unlocked: boolean;
  /** [complete, par or better, all collectibles] */
  stars: boolean[];
  emoji: string;
  gate: string;
}

export interface WorldMapOptions {
  worlds: WorldInfo[];
  selected: number;
  ballColor: string;
  onSelect(i: number): void;
  onActivate(i: number): void;
}

/** The interactive map element. Re-lays itself out (wide/tall) when its width crosses 760px. */
export class WorldMap {
  readonly el: HTMLElement;
  private readonly tip: HTMLElement;
  private mode: MapMode | null = null;
  private layout: MapLayout | null = null;
  private svg: SVGSVGElement | null = null;
  private marker: SVGElement | null = null;
  private selected: number;
  private readonly ro: ResizeObserver;

  constructor(private readonly o: WorldMapOptions) {
    this.selected = o.selected;
    this.tip = document.createElement('div');
    this.tip.className = 'map-tip hidden';
    this.el = document.createElement('div');
    this.el.className = 'world-map';
    this.el.append(this.tip);
    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(this.el);
  }

  /** Lay out for the current width (called on resize; the first call happens once attached). */
  relayout(force = false): void {
    const w = this.el.clientWidth;
    if (!w) return;
    const mode: MapMode = w >= 760 ? 'wide' : 'tall';
    if (mode === this.mode && !force) return;
    this.mode = mode;
    this.svg?.remove();
    this.layout = mapLayout(
      mode,
      this.o.worlds.map((x) => x.course.holes.length),
    );
    this.svg = this.build(this.layout);
    this.el.classList.toggle('tall', mode === 'tall');
    this.el.prepend(this.svg);
    this.moveMarker(false);
    if (mode === 'tall') this.reveal();
  }

  /** Scroll so the selected island is in view (tall layout scrolls with the screen). */
  reveal(): void {
    const g = this.svg?.querySelector<SVGGElement>(`.island[data-i="${this.selected}"]`);
    g?.scrollIntoView({ block: 'center', behavior: 'auto' });
  }

  select(i: number): void {
    if (i < 0 || i >= this.o.worlds.length) return;
    this.selected = i;
    this.svg
      ?.querySelectorAll('.island')
      .forEach((g) => g.classList.toggle('selected', Number((g as SVGElement).dataset.i) === i));
    this.moveMarker(true);
  }

  private moveMarker(animate: boolean): void {
    if (!this.marker || !this.layout) return;
    const n = this.layout.islands[this.selected].nodes[0];
    this.marker.classList.toggle('instant', !animate);
    this.marker.style.transform = `translate(${f(n.x)}px, ${f(n.y - 4)}px)`;
  }

  private build(L: MapLayout): SVGSVGElement {
    const wide = L.mode === 'wide';
    const svg = s('svg', {
      viewBox: `0 0 ${L.w} ${L.h}`,
      class: 'map-svg',
      role: 'group',
      'aria-label': 'World map',
    }) as SVGSVGElement;
    // Sea: daylight turquoise at the first world fading to a starry night by the last.
    const grad = s(
      'linearGradient',
      { id: 'mapSea', x1: 0, y1: 0, x2: wide ? 1 : 0, y2: wide ? 0 : 1 },
      s('stop', { offset: 0, 'stop-color': '#5fd6ee' }),
      s('stop', { offset: 0.45, 'stop-color': '#3fa9f0' }),
      s('stop', { offset: 0.74, 'stop-color': '#5466d6' }),
      s('stop', { offset: 1, 'stop-color': '#2a1f5c' }),
    );
    const waves = s(
      'pattern',
      { id: 'mapWaves', width: 48, height: 30, patternUnits: 'userSpaceOnUse' },
      s('path', {
        d: 'M4 12 q6 -7 12 0 M28 26 q6 -7 12 0',
        fill: 'none',
        stroke: 'rgba(255,255,255,0.38)',
        'stroke-width': 2.5,
        'stroke-linecap': 'round',
      }),
    );
    svg.append(s('defs', {}, grad, waves));
    svg.append(
      s('rect', { x: 0, y: 0, width: L.w, height: L.h, fill: 'url(#mapSea)' }),
      s('rect', {
        x: -48,
        y: -30,
        width: L.w + 96,
        height: L.h + 60,
        fill: 'url(#mapWaves)',
        class: 'map-waves',
      }),
    );
    // Stars over the night end of the sea.
    const stars = s('g', { class: 'map-stars' });
    for (let k = 0; k < 40; k++) {
      const a = (Math.sin(k * 12.9898) * 43758.5453) % 1;
      const b = (Math.sin(k * 78.233) * 12543.123) % 1;
      const fx = Math.abs(a),
        fy = Math.abs(b);
      const x = wide ? L.w * (0.72 + fx * 0.28) : L.w * fy;
      const y = wide ? L.h * fy : L.h * (0.76 + fx * 0.24);
      stars.append(
        s('circle', {
          cx: f(x),
          cy: f(y),
          r: (1 + (k % 3) * 0.7).toFixed(1),
          fill: '#fff',
          style: `animation-delay:${(k % 7) * 0.4}s`,
        }),
      );
    }
    svg.append(stars);

    // Bridges between islands (under the islands so they tuck in at the shore).
    const bridges = s('g', { class: 'map-bridges' });
    for (let i = 0; i < L.islands.length - 1; i++) {
      const a = L.islands[i].nodes.at(-1)!;
      const b = L.islands[i + 1].nodes[0];
      const mx = (a.x + b.x) / 2,
        my = (a.y + b.y) / 2;
      const nx = -(b.y - a.y),
        ny = b.x - a.x;
      const nl = Math.hypot(nx, ny) || 1;
      const bend = (i % 2 ? -1 : 1) * 30;
      const d = `M${f(a.x)} ${f(a.y)} Q${f(mx + (nx / nl) * bend)} ${f(my + (ny / nl) * bend)} ${f(b.x)} ${f(b.y)}`;
      const open = this.o.worlds[i + 1].unlocked;
      bridges.append(
        s('path', { d, class: `bridge-ink ${open ? '' : 'locked'}` }),
        s('path', { d, class: `bridge ${open ? '' : 'locked'}` }),
      );
    }
    svg.append(bridges);

    L.islands.forEach((isl, i) => svg.append(this.island(isl, i)));

    // The player's ball marker.
    this.marker = s(
      'g',
      { class: 'map-marker', 'aria-hidden': 'true' },
      s(
        'g',
        { class: 'mm-bob', transform: 'scale(1.45)' },
        s('ellipse', { cx: 0, cy: 2, rx: 13, ry: 5, fill: 'rgba(0,0,0,0.28)', class: 'mm-shadow' }),
        s(
          'g',
          { class: 'mm-ball' },
          s('circle', { cx: 0, cy: -22, r: 14, fill: this.o.ballColor, stroke: INK, 'stroke-width': 3 }),
          s('ellipse', { cx: -4.5, cy: -27, rx: 4.5, ry: 3, fill: 'rgba(255,255,255,0.85)' }),
          s('circle', { cx: 4, cy: -18, r: 1.4, fill: 'rgba(0,0,0,0.18)' }),
          s('circle', { cx: 7, cy: -23, r: 1.4, fill: 'rgba(0,0,0,0.18)' }),
          s('circle', { cx: 1, cy: -14, r: 1.4, fill: 'rgba(0,0,0,0.18)' }),
        ),
      ),
    );
    svg.append(this.marker);
    return svg;
  }

  private island(isl: IslandLayout, i: number): SVGElement {
    const w = this.o.worlds[i];
    const th = w.course.theme;
    const outline = islandOutline(i * 1.7 + 0.4, isl.rx, isl.ry);
    const g = s('g', {
      class: `island ${w.unlocked ? '' : 'locked'} ${i === this.selected ? 'selected' : ''} w-${w.course.world}`,
      'data-i': i,
      tabindex: 0,
      role: 'button',
      'aria-label': `${w.course.name}${w.unlocked ? '' : ' (locked)'}`,
    });
    const cliff = 24;
    const art = s('g', { class: 'island-art', transform: `translate(${f(isl.cx)} ${f(isl.cy)})` });
    art.append(
      // Shadow in the water, cliff side, then the turf top with a lighter inner patch.
      s('polygon', { points: poly(outline, 8, cliff + 14, 1.02), fill: 'rgba(20,20,70,0.22)' }),
      s('polygon', {
        points: poly(outline, 0, cliff),
        fill: th.wall,
        stroke: INK,
        'stroke-width': 3.5,
        'stroke-linejoin': 'round',
      }),
      s('polygon', { points: poly(outline, 0, cliff * 0.45, 0.995), fill: th.wallTop, opacity: 0.55 }),
      s('polygon', {
        points: poly(outline),
        fill: th.floorA,
        stroke: INK,
        'stroke-width': 3.5,
        'stroke-linejoin': 'round',
        class: 'island-top',
      }),
      s('polygon', { points: poly(outline, -6, -6, 0.8), fill: th.floorB, opacity: 0.55 }),
      s('polygon', {
        points: poly(outline, -isl.rx * 0.18, -isl.ry * 0.22, 0.42),
        fill: '#fff',
        opacity: 0.12,
      }),
    );
    // Props round the shore, kept clear of the path and the badge.
    const local = isl.nodes.map((p) => ({ x: p.x - isl.cx, y: p.y - isl.cy }));
    const badge = { x: isl.badge.x - isl.cx, y: isl.badge.y - isl.cy };
    let k = 0;
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * Math.PI * 2 + i;
      const p = { x: Math.cos(ang) * isl.rx * 0.8, y: Math.sin(ang) * isl.ry * 0.78 };
      const clear =
        local.every((n) => Math.hypot(n.x - p.x, n.y - p.y) > NODE_R + 18) &&
        Math.hypot(badge.x - p.x, badge.y - p.y) > 64;
      if (clear) art.append(prop(w.course.world, p.x, p.y, 12 + (a % 3) * 2, k++));
    }
    g.append(art);

    // The path: a dashed trail through every stone.
    g.append(
      s('path', { d: smoothPath(isl.nodes), class: 'trail-ink' }),
      s('path', { d: smoothPath(isl.nodes), class: 'trail' }),
    );

    // World badge + name sign + stars.
    const bx = isl.badge.x,
      by = isl.badge.y;
    const nameW = Math.max(116, w.course.name.length * 11 + 32);
    // Keep the name sign inside the map on narrow layouts.
    const W = this.layout?.w ?? Infinity;
    const px = Math.min(Math.max(0, nameW / 2 + 8 - bx), W - 8 - nameW / 2 - bx);
    g.append(
      s(
        'g',
        { class: 'map-badge', transform: `translate(${f(bx)} ${f(by)})` },
        s('circle', { cx: 0, cy: 4, r: 35, fill: INK }),
        s('circle', {
          cx: 0,
          cy: 0,
          r: 34,
          fill: w.unlocked ? '#fffaf0' : '#d9d3ea',
          stroke: INK,
          'stroke-width': 3.5,
        }),
        s('text', { x: 0, y: 12, class: 'badge-emoji' }, w.unlocked ? w.emoji : '🔒'),
        s('rect', { x: f(px - nameW / 2), y: 36, width: f(nameW), height: 30, rx: 15, class: 'name-pill' }),
        s('text', { x: f(px), y: 57, class: 'name-text' }, w.course.name),
        w.unlocked
          ? s(
              'g',
              { class: 'badge-stars', transform: 'translate(0 86)' },
              ...[0, 1, 2].map((j) =>
                s('text', { x: (j - 1) * 22, y: 0, class: w.stars[j] ? 'on' : '' }, '★'),
              ),
            )
          : s('text', { x: 0, y: 88, class: 'gate-text' }, w.gate),
      ),
    );

    // Stepping stones, one per hole.
    isl.nodes.forEach((n, j) => {
      const hole = w.course.holes[j];
      const last = j === isl.nodes.length - 1;
      const node = s(
        'g',
        {
          class: `map-node ${w.unlocked ? '' : 'locked'} ${w.stars[0] ? 'done' : ''}`,
          transform: `translate(${f(n.x)} ${f(n.y)})`,
          'data-hole': j,
        },
        s('circle', { cx: 0, cy: 0, r: NODE_R + 9, class: 'hit' }),
        s('ellipse', { cx: 0, cy: 5, rx: NODE_R + 1, ry: NODE_R - 2, fill: INK }),
        s('circle', { cx: 0, cy: 0, r: NODE_R, class: 'stone' }),
        s('text', { x: 0, y: 6, class: 'num' }, String(j + 1)),
        last
          ? s(
              'g',
              { class: 'node-flag', transform: 'translate(6 -14)' },
              s('line', {
                x1: 0,
                y1: 0,
                x2: 0,
                y2: -24,
                stroke: INK,
                'stroke-width': 3,
                'stroke-linecap': 'round',
              }),
              s('polygon', {
                points: '0,-24 16,-18 0,-12',
                fill: '#ff5fa2',
                stroke: INK,
                'stroke-width': 2.5,
                'stroke-linejoin': 'round',
              }),
            )
          : null,
      );
      const show = () => this.showTip(node, `Hole ${j + 1} · ${hole.name}`, `Par ${hole.par}`);
      node.addEventListener('pointerenter', show);
      node.addEventListener('pointerleave', () => this.tip.classList.add('hidden'));
      node.addEventListener('click', (e) => {
        e.stopPropagation();
        this.o.onSelect(i);
        show();
      });
      g.append(node);
    });

    g.addEventListener('click', () => {
      if (this.selected === i) this.o.onActivate(i);
      else this.o.onSelect(i);
    });
    g.addEventListener('keydown', (e) => {
      const k = (e as KeyboardEvent).key;
      if (k !== 'Enter' && k !== ' ') return;
      e.preventDefault();
      if (this.selected === i) this.o.onActivate(i);
      else this.o.onSelect(i);
    });
    return g;
  }

  private showTip(node: SVGElement, title: string, sub: string): void {
    const r = node.getBoundingClientRect();
    const box = this.el.getBoundingClientRect();
    this.tip.replaceChildren(
      Object.assign(document.createElement('b'), { textContent: title }),
      Object.assign(document.createElement('span'), { textContent: sub }),
    );
    this.tip.style.left = `${r.left + r.width / 2 - box.left}px`;
    this.tip.style.top = `${r.top - box.top}px`;
    this.tip.classList.remove('hidden');
  }

  dispose(): void {
    this.ro.disconnect();
  }
}
