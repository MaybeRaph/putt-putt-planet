import { h } from './dom';

/** v1.12 photo mode filters: a CSS filter for the live view, reused when saving the picture. */
export const PHOTO_FILTERS = [
  { id: 'none', label: 'Natural', css: 'none' },
  { id: 'warm', label: 'Golden', css: 'sepia(0.25) saturate(1.25) brightness(1.05)' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.6) contrast(1.08)' },
  { id: 'cool', label: 'Frosty', css: 'hue-rotate(-12deg) saturate(0.9) brightness(1.06)' },
  { id: 'dream', label: 'Dreamy', css: 'saturate(1.2) brightness(1.1) contrast(0.9) blur(0.4px)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.25)' },
  { id: 'retro', label: 'Retro', css: 'sepia(0.6) contrast(1.1) saturate(0.9)' },
] as const;
export type PhotoFilter = (typeof PHOTO_FILTERS)[number]['id'];

export interface PhotoOptions {
  filter: PhotoFilter;
  frame: boolean;
  caption: string;
}

/** File name for a saved photo, e.g. putt-putt-planet-2026-11-16-21-04-33.png. */
export function photoFileName(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `putt-putt-planet-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
}

/**
 * Compose the saved picture from the game canvas: the filter, and optionally a white instant-photo
 * frame with a caption. Must run right after the game rendered (same task), while the WebGL
 * drawing buffer still holds the frame.
 */
export function composePhoto(src: HTMLCanvasElement, o: PhotoOptions): HTMLCanvasElement {
  const w = src.width,
    hgt = src.height;
  const pad = o.frame ? Math.round(Math.min(w, hgt) * 0.04) : 0;
  const foot = o.frame ? Math.round(Math.min(w, hgt) * 0.14) : 0;
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = hgt + pad + (o.frame ? foot : 0) + (o.frame ? 0 : 0);
  const ctx = out.getContext('2d')!;
  if (o.frame) {
    ctx.fillStyle = '#fffaf0';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  const css = PHOTO_FILTERS.find((f) => f.id === o.filter)?.css ?? 'none';
  ctx.filter = css;
  ctx.drawImage(src, pad, pad, w, hgt);
  ctx.filter = 'none';
  if (o.frame) {
    // Soft vignette on the picture, then the caption under it.
    const g = ctx.createRadialGradient(
      pad + w / 2,
      pad + hgt / 2,
      Math.min(w, hgt) * 0.35,
      pad + w / 2,
      pad + hgt / 2,
      Math.max(w, hgt) * 0.75,
    );
    g.addColorStop(0, 'rgba(42,31,92,0)');
    g.addColorStop(1, 'rgba(42,31,92,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(pad, pad, w, hgt);
    const fs = Math.round(foot * 0.36);
    ctx.fillStyle = '#2a1f5c';
    ctx.textBaseline = 'middle';
    ctx.font = `${fs}px "Lilita One", "Baloo 2", sans-serif`;
    ctx.fillText('⛳ Putt-Putt Planet', pad, pad + hgt + foot / 2);
    ctx.textAlign = 'right';
    ctx.font = `700 ${Math.round(fs * 0.62)}px "Baloo 2", sans-serif`;
    ctx.fillStyle = '#6b5f99';
    ctx.fillText(o.caption, pad + w, pad + hgt + foot / 2);
  }
  return out;
}

/** Save (or on phones, share) a picture. */
export async function savePhoto(cv: HTMLCanvasElement, name = photoFileName()): Promise<'saved' | 'shared'> {
  const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Could not make the picture');
  const file = new File([blob], name, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const coarse = matchMedia('(pointer: coarse)').matches;
  if (coarse && nav.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Putt-Putt Planet' });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'saved';
}

/** The photo mode bar: filters, frame and hide-ball toggles, Snap and Exit. */
export function photoBar(o: {
  state: PhotoOptions & { hideBalls: boolean };
  onChange(): void;
  onSnap(): void;
  onExit(): void;
}): HTMLElement {
  const chips = PHOTO_FILTERS.map((f) =>
    h(
      'button',
      {
        class: `btn small photo-chip ${o.state.filter === f.id ? 'selected' : ''}`,
        onclick: (e: Event) => {
          o.state.filter = f.id;
          (e.currentTarget as HTMLElement).parentElement
            ?.querySelectorAll('.photo-chip')
            .forEach((c) => c.classList.toggle('selected', c === e.currentTarget));
          o.onChange();
        },
      },
      f.label,
    ),
  );
  const toggle = (label: string, key: 'frame' | 'hideBalls') =>
    h(
      'label',
      { class: 'photo-toggle' },
      h('input', {
        type: 'checkbox',
        checked: o.state[key],
        onchange: (e: Event) => {
          o.state[key] = (e.target as HTMLInputElement).checked;
          o.onChange();
        },
      }),
      label,
    );
  return h(
    'div',
    { class: 'photo-bar panel' },
    h(
      'div',
      { class: 'photo-title' },
      '📸 Photo mode',
      h('small', {}, 'Drag to orbit · scroll or pinch to zoom'),
    ),
    h('div', { class: 'photo-chips' }, ...chips),
    h('div', { class: 'photo-row' }, toggle('Frame & caption', 'frame'), toggle('Hide balls', 'hideBalls')),
    h(
      'div',
      { class: 'photo-row' },
      h('button', { class: 'btn primary big photo-snap', onclick: () => o.onSnap() }, '📸 Snap'),
      h('button', { class: 'btn photo-exit', onclick: () => o.onExit() }, '✕ Exit'),
    ),
  );
}
