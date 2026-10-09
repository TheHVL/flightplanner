import { openLegEditor } from './legEditorEvents';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { WaypointListResize } from './WaypointListResize';

export class RoutePanel {
  private draggedId: string | null = null;
  private pointerDrag: { pointerId: number; handle: HTMLElement; startY: number; y: number; x: number; moved: boolean } | null = null;
  private scrollFrame = 0;
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('click', (event) => this.handleClick(event));
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.element.addEventListener('pointerdown', event => {
      const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-drag-waypoint]');
      const id = handle?.closest<HTMLElement>('[data-id]')?.dataset.id;
      if (!handle || !id || event.button !== 0) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      this.draggedId = id;
      this.pointerDrag = { pointerId: event.pointerId, handle, startY: event.clientY, y: event.clientY, x: event.clientX, moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointermove', event => {
      const drag = this.pointerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag.x = event.clientX; drag.y = event.clientY;
      if (Math.abs(drag.y - drag.startY) >= 5) drag.moved = true;
      if (!drag.moved) return;
      event.preventDefault();
      drag.handle.closest('.waypoint-card')?.classList.add('waypoint-dragging');
      this.showPointerDrop();
      if (!this.scrollFrame) this.scrollFrame = requestAnimationFrame(() => this.scrollWhileDragging());
    });
    this.element.addEventListener('pointerup', event => {
      const drag = this.pointerDrag;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const position = drag.moved ? this.pointerDropPosition() : null;
      const id = this.draggedId;
      this.clearDrag();
      if (id && position) this.moveDroppedWaypoint(id, position);
    });
    this.element.addEventListener('pointercancel', () => this.clearDrag());
    this.element.addEventListener('lostpointercapture', () => { if (this.pointerDrag) this.clearDrag(); });
    this.element.addEventListener('keydown', event => { if (event.key === 'Escape') this.clearDrag(); });
  }

  render(): void {
    this.clearDrag();
    const waypoints = this.store.getWaypoints();
    let list = this.element.querySelector<HTMLElement>('.waypoint-list');
    if (!list) {
      this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">ROUTE</p>
          <h2>Waypoints</h2>
        </div>
        <button class="ghost-button" data-action="clear" ${waypoints.length === 0 ? 'disabled' : ''}>Clear</button>
      </div>
      <p class="hint">Drag a numbered waypoint handle to reorder the list, or use ↑ / ↓. Click a route line to add a waypoint between its endpoints or prepare that leg. Drag a map waypoint to move it; drag a route line to shape the flown path. Ctrl+Z / Cmd+Z undoes the latest action.</p>
      <p class="waypoint-reorder-status" role="status" aria-live="polite"></p>
      <div class="waypoint-list" id="route-waypoint-list"></div>
      <div class="waypoint-list-resize" role="separator" tabindex="0" aria-orientation="horizontal"
        aria-label="Waypoint list height" aria-controls="route-waypoint-list"
        title="Drag up or down to resize. Arrow keys also resize. Double-click to reset."><span aria-hidden="true">↕</span> Resize waypoint list</div>
      `;
      list = this.element.querySelector<HTMLElement>('.waypoint-list')!;
      new WaypointListResize(this.element, list, this.element.querySelector<HTMLElement>('.waypoint-list-resize')!);
    }
    const scrollTop = list.scrollTop;
    const sidebar = this.element.closest<HTMLElement>('#planning-sidebar');
    const sidebarScrollTop = sidebar?.scrollTop ?? 0;
    list.innerHTML = `${waypoints.length === 0 ? '<div class="empty-state">No route yet</div>' : ''}
      ${waypoints.map((waypoint, index) => this.waypointRow(waypoint.id, waypoint.name, waypoint.lat, waypoint.lon, index, waypoints.length)).join('')}`;
    list.scrollTop = scrollTop;
    if (sidebar) sidebar.scrollTop = sidebarScrollTop;
    this.element.querySelector<HTMLButtonElement>('[data-action="clear"]')!.disabled = waypoints.length === 0;
    this.element.querySelector<HTMLElement>('.waypoint-reorder-status')!.textContent = '';
  }

  private waypointRow(
    id: string,
    name: string,
    lat: number,
    lon: number,
    index: number,
    count: number,
  ): string {
    const role = index === 0 ? 'DEP' : index === count - 1 ? 'DEST' : `WP ${index}`;
    return `
      <article class="waypoint-card" data-id="${this.escape(id)}">
        <button type="button" class="waypoint-index waypoint-drag-handle" data-drag-waypoint title="Drag to reorder; use ↑ / ↓ buttons with the keyboard" aria-label="Drag waypoint ${index + 1}, ${this.escape(name)}, to reorder">${index + 1}<span aria-hidden="true">⠿</span></button>
        <div class="waypoint-main">
          <div class="waypoint-topline">
            <span class="role-badge">${role}</span>
            <input class="waypoint-name" data-field="name" value="${this.escape(name)}" aria-label="Waypoint name" />
          </div>
          <div class="coords">${lat.toFixed(5)}° / ${lon.toFixed(5)}°</div>
          <div class="waypoint-planning-actions">${index < count - 1 ? `<button type="button" data-action="prepare">Prepare next leg</button>` : ''}<button type="button" data-action="visit" ${count < 2 ? 'disabled title="Add a destination first"' : ''}>${this.store.isAirportWaypoint(id) ? 'Airport / pattern' : 'Waypoint settings'}</button></div>
        </div>
        <div class="waypoint-actions">
          <button class="icon-button" data-action="up" title="Move up" aria-label="Move ${this.escape(name)} up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-button" data-action="down" title="Move down" aria-label="Move ${this.escape(name)} down" ${index === count - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-button danger" data-action="remove" title="Remove" aria-label="Remove ${this.escape(name)}">×</button>
        </div>
      </article>
    `;
  }

  private handleClick(event: Event): void {
    const target = event.target as HTMLElement;
    const button = target.closest<HTMLButtonElement>('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'clear') {
      this.store.clear();
      return;
    }

    const card = button.closest<HTMLElement>('[data-id]');
    const id = card?.dataset.id;
    if (!id) return;

    if (action === 'prepare' || action === 'visit') {
      const legs = this.store.getLegs();
      const leg = action === 'prepare' ? legs.find(l => l.from.id === id) : legs.find(l => l.to.id === id) ?? legs.find(l => l.from.id === id);
      if (leg) openLegEditor({ fromId: leg.from.id, toId: leg.to.id, focus: action === 'visit' ? 'waypoint' : 'pl', waypointId: id });
      return;
    }
    if (action === 'up') this.store.moveWaypoint(id, -1);
    if (action === 'down') this.store.moveWaypoint(id, 1);
    if (action === 'remove') {
      const points = this.store.getWaypoints();
      const index = points.findIndex(point => point.id === id);
      const nextId = (points[index + 1] ?? points[index - 1])?.id;
      this.store.removeWaypoint(id);
      const next = [...this.element.querySelectorAll<HTMLElement>('[data-id]')].find(item => item.dataset.id === nextId);
      const focusTarget = next?.querySelector<HTMLElement>('[data-action="remove"]')
        ?? this.element.querySelector<HTMLElement>('.waypoint-list-resize');
      focusTarget?.focus({ preventScroll: true });
    }
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset.field !== 'name') return;

    const card = input.closest<HTMLElement>('[data-id]');
    const id = card?.dataset.id;
    if (!id) return;

    this.store.updateWaypoint(id, { name: input.value.trim() || 'WP' });
  }

  private dropPosition(target: HTMLElement, clientY: number): { card: HTMLElement; after: boolean } | null {
    const card = target.closest<HTMLElement>('.waypoint-card');
    if (!card || !this.element.contains(card)) return null;
    const bounds = card.getBoundingClientRect();
    return { card, after: clientY >= bounds.top + bounds.height / 2 };
  }

  private moveDroppedWaypoint(id: string, position: { card: HTMLElement; after: boolean }): void {
    const points = this.store.getWaypoints();
    const from = points.findIndex(point => point.id === id);
    const target = points.findIndex(point => point.id === position.card.dataset.id);
    const insertion = target + Number(position.after);
    const nextIndex = insertion - Number(from < insertion);
    if (from < 0 || target < 0 || from === nextIndex) return;
    const name = points[from].name;
    this.store.moveWaypointToIndex(id, nextIndex);
    const card = [...this.element.querySelectorAll<HTMLElement>('[data-id]')].find(item => item.dataset.id === id);
    card?.querySelector<HTMLElement>('[data-drag-waypoint]')?.focus({ preventScroll: true });
    const status = this.element.querySelector<HTMLElement>('.waypoint-reorder-status');
    if (status) status.textContent = `${name} moved to position ${nextIndex + 1}.`;
  }

  private clearDropIndicators(): void {
    for (const card of this.element.querySelectorAll('.waypoint-drop-before, .waypoint-drop-after')) card.classList.remove('waypoint-drop-before', 'waypoint-drop-after');
  }

  private clearDrag(): void {
    const drag = this.pointerDrag;
    this.pointerDrag = null;
    if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    cancelAnimationFrame(this.scrollFrame);
    this.scrollFrame = 0;
    this.draggedId = null;
    this.clearDropIndicators();
    this.element.querySelector('.waypoint-dragging')?.classList.remove('waypoint-dragging');
  }

  private pointerDropPosition(): { card: HTMLElement; after: boolean } | null {
    const drag = this.pointerDrag;
    const target = drag ? document.elementFromPoint(drag.x, drag.y) as HTMLElement | null : null;
    return target && drag ? this.dropPosition(target, drag.y) : null;
  }

  private showPointerDrop(): void {
    this.clearDropIndicators();
    const position = this.pointerDropPosition();
    position?.card.classList.add(position.after ? 'waypoint-drop-after' : 'waypoint-drop-before');
  }

  private scrollWhileDragging(): void {
    this.scrollFrame = 0;
    const drag = this.pointerDrag;
    if (!drag?.moved) return;
    const list = this.element.querySelector<HTMLElement>('.waypoint-list');
    const sidebar = this.element.closest<HTMLElement>('#planning-sidebar');
    for (const area of [list, sidebar]) {
      if (!area) continue;
      const bounds = area.getBoundingClientRect();
      if (drag.x < bounds.left || drag.x > bounds.right) continue;
      const top = Math.max(0, bounds.top), bottom = Math.min(window.innerHeight, bounds.bottom);
      if (drag.y >= top && drag.y < top + 28) area.scrollTop -= 10;
      else if (drag.y <= bottom && drag.y > bottom - 28) area.scrollTop += 10;
    }
    this.showPointerDrop();
    this.scrollFrame = requestAnimationFrame(() => this.scrollWhileDragging());
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
