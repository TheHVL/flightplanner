import { readPreference, writePreference } from '../utils/preferences';

const DEFAULT_HEIGHT = 360;
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 1000;
const STORAGE_KEY = 'flightplanner-waypoint-list-height';

/** List size is a UI preference, separate from route data and plan history. */
export class WaypointListResize {
  private height = DEFAULT_HEIGHT;
  private pointerId: number | null = null;
  private startY = 0;
  private startHeight = 0;

  constructor(private readonly panel: HTMLElement, list: HTMLElement, private readonly handle: HTMLElement) {
    const saved = Number(readPreference(STORAGE_KEY));
    this.apply(Number.isFinite(saved) && saved >= MIN_HEIGHT ? saved : DEFAULT_HEIGHT);
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.pointerId !== null) return;
      this.pointerId = event.pointerId;
      this.startY = event.clientY;
      this.startHeight = list.getBoundingClientRect().height;
      handle.setPointerCapture(event.pointerId);
      handle.focus({ preventScroll: true });
      handle.classList.add('is-resizing');
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (event.pointerId === this.pointerId) this.apply(this.startHeight + event.clientY - this.startY);
    });
    const finish = () => {
      if (this.pointerId === null) return;
      const id = this.pointerId;
      this.pointerId = null;
      if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
      handle.classList.remove('is-resizing');
      writePreference(STORAGE_KEY, String(this.height));
    };
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    handle.addEventListener('dblclick', () => this.apply(DEFAULT_HEIGHT, true));
    handle.addEventListener('keydown', event => {
      const heights: Record<string, number> = { ArrowUp: this.height - 20, ArrowDown: this.height + 20, Home: MIN_HEIGHT, End: MAX_HEIGHT };
      if (!(event.key in heights)) return;
      event.preventDefault();
      this.apply(heights[event.key], true);
    });
  }

  private apply(height: number, persist = false): void {
    this.height = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, height)));
    this.panel.style.setProperty('--waypoint-list-height', `${this.height}px`);
    this.handle.setAttribute('aria-valuemin', String(MIN_HEIGHT));
    this.handle.setAttribute('aria-valuemax', String(MAX_HEIGHT));
    this.handle.setAttribute('aria-valuenow', String(this.height));
    this.handle.setAttribute('aria-valuetext', `${this.height} pixels`);
    if (persist) writePreference(STORAGE_KEY, String(this.height));
  }
}
