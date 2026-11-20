/** Classic yellow hover tooltip (DOM) shared by the optics and circuit viewports. */
import type { Vec2 } from '@core/types';

// ---------------------------------------------------------------------------
// Classic tooltip (DOM, yellow info background)
// ---------------------------------------------------------------------------

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export interface TipRow { k: string; v: string; swatch?: string }
export interface TipContent { title: string; sub?: string; rows: TipRow[] }

export function tipHTML(t: TipContent): string {
  const rows = t.rows.map((r) => `<tr><td class="k">${esc(r.k)}</td><td>${r.swatch ? `<span class="sw" style="background:${r.swatch}"></span>` : ''}${esc(r.v)}</td></tr>`).join('');
  return `<div class="t">${esc(t.title)}</div>${t.sub ? `<div class="s">${esc(t.sub)}</div>` : ''}${rows ? `<table>${rows}</table>` : ''}`;
}

/** Hover tooltip with the classic ~400 ms initial delay; switching targets while shown is immediate. */
export class HoverTip {
  readonly el: HTMLDivElement;
  private key: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private shown = false;
  private pos: Vec2 = { x: 0, y: 0 };
  private content: (() => TipContent | null) | null = null;

  constructor(private host: HTMLElement, cls = 'obw-tooltip') {
    this.el = document.createElement('div');
    this.el.className = cls;
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    host.appendChild(this.el);
  }

  get visible(): boolean { return this.shown; }
  get target(): string | null { return this.key; }

  /** Point the tip at `key` (null hides). `content` is re-evaluated on refresh() for live values. */
  set(key: string | null, at: Vec2, content: (() => TipContent | null) | null): void {
    this.pos = at;
    if (key === null) { this.hide(); return; }
    this.content = content;
    if (key === this.key) { if (this.shown) this.place(); return; }
    this.key = key;
    if (this.shown) { this.render(); return; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.shown = true; this.render(); }, 380);
  }

  hide(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.key = null; this.content = null;
    if (this.shown) { this.shown = false; this.el.hidden = true; }
  }

  /** Re-render live content (detector readings, circuit values). */
  refresh(): void { if (this.shown) this.render(); }

  private render(): void {
    const c = this.content?.();
    if (!c) { this.el.hidden = true; return; }
    const html = tipHTML(c);
    if (this.el.innerHTML !== html) this.el.innerHTML = html;
    this.el.hidden = false;
    this.place();
  }

  private place(): void {
    const W = this.host.clientWidth, H = this.host.clientHeight;
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    let x = this.pos.x + 12, y = this.pos.y + 20;
    if (x + w > W - 2) x = Math.max(2, this.pos.x - w - 6);
    if (y + h > H - 2) y = Math.max(2, this.pos.y - h - 8);
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }

  dispose(): void { this.hide(); this.el.remove(); }
}
