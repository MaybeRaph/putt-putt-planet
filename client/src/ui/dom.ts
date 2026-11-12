/** Tiny DOM helpers: the UI is plain HTML/CSS, no framework. */

type Attrs = Record<string, string | number | boolean | ((e: Event) => void) | undefined | null>;
type Child = Node | string | number | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function')
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'html') el.innerHTML = String(v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

/** Animate a number in an element from `from` to `to`. */
export function tweenNumber(
  el: HTMLElement,
  from: number,
  to: number,
  ms = 600,
  onTick?: () => void,
): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let lastShown = from;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(from + (to - from) * e);
      if (v !== lastShown) {
        lastShown = v;
        onTick?.();
      }
      el.textContent = String(v);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    step();
  });
}

export function pulse(el: HTMLElement, cls = 'pulse'): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export const scoreName = (strokes: number, par: number): string => {
  if (strokes === 1) return 'Hole in One!';
  const d = strokes - par;
  return (
    (
      {
        [-4]: 'Condor!',
        [-3]: 'Albatross!',
        [-2]: 'Eagle!',
        [-1]: 'Birdie!',
        0: 'Par',
        1: 'Bogey',
        2: 'Double Bogey',
        3: 'Triple Bogey',
      } as Record<number, string>
    )[d] ?? `+${d}`
  );
};

export const relScore = (strokes: number, par: number): string => {
  const d = strokes - par;
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`;
};
