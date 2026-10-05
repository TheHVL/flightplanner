const DEFAULT_WIDTH = 340;
const MIN_WIDTH = 300;
const MAX_WIDTH = 760;
const STORAGE_KEY = 'flightplanner-sidebar-width';

/** Keeps a useful map area while allowing the planning controls to grow. */
export class SidebarResize {
  private preferredWidth: number;
  private pointerId: number | null = null;
  private startX = 0;
  private startWidth = 0;

  constructor(private readonly workspace: HTMLElement, private readonly sidebar: HTMLElement,
    private readonly handle: HTMLElement, private readonly onResize: () => void) {
    const saved = Number(localStorage.getItem(STORAGE_KEY));
    this.preferredWidth = Number.isFinite(saved) && saved >= MIN_WIDTH ? saved : DEFAULT_WIDTH;
    this.apply(this.preferredWidth);
    window.addEventListener('resize', () => this.apply(this.preferredWidth));
    handle.addEventListener('pointerdown', event => {
      if (window.innerWidth <= 900 || event.button !== 0) return;
      this.pointerId = event.pointerId;
      this.startX = event.clientX;
      this.startWidth = this.sidebar.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add('sidebar-resizing');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (event.pointerId === this.pointerId) this.apply(this.startWidth + event.clientX - this.startX);
    });
    const finish = () => {
      if (this.pointerId === null) return;
      const id = this.pointerId;
      this.pointerId = null;
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      document.body.classList.remove('sidebar-resizing');
      this.apply(Number(handle.getAttribute('aria-valuenow')), true);
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('dblclick', () => this.apply(DEFAULT_WIDTH, true));
    handle.addEventListener('keydown', event => {
      if (window.innerWidth <= 900) return;
      const current = Number(handle.getAttribute('aria-valuenow'));
      const widths: Record<string, number> = { ArrowLeft: current - 20, ArrowRight: current + 20, Home: MIN_WIDTH, End: this.maxWidth() };
      if (!(event.key in widths)) return;
      event.preventDefault();
      this.apply(widths[event.key], true);
    });
  }

  private maxWidth(): number {
    const style = getComputedStyle(this.workspace);
    const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
    return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, this.workspace.getBoundingClientRect().width - padding - 414));
  }

  private apply(width: number, persist = false): void {
    const max = this.maxWidth();
    const clamped = Math.round(Math.max(MIN_WIDTH, Math.min(max, width)));
    this.workspace.style.setProperty('--sidebar-width', `${clamped}px`);
    this.handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
    this.handle.setAttribute('aria-valuemax', String(Math.round(max)));
    this.handle.setAttribute('aria-valuenow', String(clamped));
    this.handle.setAttribute('aria-valuetext', `${clamped} pixels`);
    if (persist) {
      this.preferredWidth = clamped;
      localStorage.setItem(STORAGE_KEY, String(clamped));
    }
    this.onResize();
  }
}
