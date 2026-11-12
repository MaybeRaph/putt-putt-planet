import { h, clear, pulse } from './dom';
import { audio } from '../audio/Audio';

/** DOM layers above the canvas: screens (menus), HUD, modal overlay, toasts. */
export class UIRoot {
  readonly root: HTMLElement;
  readonly screenLayer: HTMLElement;
  readonly hudLayer: HTMLElement;
  readonly overlayLayer: HTMLElement;
  private readonly toastLayer: HTMLElement;
  private readonly fps: HTMLElement;
  private readonly loading: HTMLElement;

  constructor(parent: HTMLElement) {
    this.screenLayer = h('div', { class: 'layer screens' });
    this.hudLayer = h('div', { class: 'layer hud-layer' });
    this.overlayLayer = h('div', { class: 'layer overlay hidden' });
    this.toastLayer = h('div', { class: 'toasts' });
    this.fps = h('div', { class: 'fps hidden' });
    this.loading = h(
      'div',
      { class: 'loading hidden' },
      h('div', { class: 'spinner' }),
      h('div', { class: 'loading-text' }, 'Loading…'),
    );
    this.root = h(
      'div',
      { class: 'ui' },
      this.hudLayer,
      this.screenLayer,
      this.overlayLayer,
      this.loading,
      this.toastLayer,
      this.fps,
    );
    parent.appendChild(this.root);
    // UI click sounds for every button.
    this.root.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('button') && !t.closest('button')!.classList.contains('silent'))
        audio.ui(t.closest('.back') ? 'back' : 'click');
    });
  }

  private leaveHooks: (() => void)[] = [];

  /** Run `fn` when the current screen is replaced (e.g. dispose a preview renderer). */
  onLeave(fn: () => void): void {
    this.leaveHooks.push(fn);
  }

  showScreen(el: HTMLElement | null, animate = true): void {
    if (animate) {
      this.leaveHooks.forEach((f) => f());
      this.leaveHooks = [];
    }
    const scroll = this.screenLayer.firstElementChild?.scrollTop ?? 0;
    clear(this.screenLayer);
    if (el) {
      this.screenLayer.append(el);
      if (animate) pulse(el, 'enter');
      else el.scrollTop = scroll;
    }
  }

  showOverlay(el: HTMLElement | null): void {
    clear(this.overlayLayer);
    this.overlayLayer.classList.toggle('hidden', !el);
    if (el) {
      this.overlayLayer.append(el);
      pulse(el, 'enter');
    }
  }

  get overlayOpen(): boolean {
    return !this.overlayLayer.classList.contains('hidden');
  }

  clearHud(): void {
    clear(this.hudLayer);
  }

  setLoading(text: string | null): void {
    this.loading.classList.toggle('hidden', text === null);
    if (text) (this.loading.querySelector('.loading-text') as HTMLElement).textContent = text;
  }

  toast(text: string, kind: 'info' | 'good' | 'bad' = 'info', ms = 3000): void {
    const t = h('div', { class: `toast ${kind}` }, text);
    this.toastLayer.append(t);
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  setFps(n: number | null): void {
    this.fps.classList.toggle('hidden', n === null);
    if (n !== null) this.fps.textContent = `${n} fps`;
  }
}
