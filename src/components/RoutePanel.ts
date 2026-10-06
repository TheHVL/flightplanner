import { openLegEditor } from './legEditorEvents';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';

export class RoutePanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('click', (event) => this.handleClick(event));
    this.element.addEventListener('change', (event) => this.handleChange(event));
  }

  render(): void {
    const waypoints = this.store.getWaypoints();

    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">ROUTE</p>
          <h2>Waypoints</h2>
        </div>
        <button class="ghost-button" data-action="clear" ${waypoints.length === 0 ? 'disabled' : ''}>Clear</button>
      </div>
      <p class="hint">Click an airport or reporting point on the map to add it, or use the list below. Nearby clicks and waypoint drops snap while Snap to AIP points is on. Click a route leg to prepare it. Drag a waypoint to move it or a blue line to shape the flown path. Ctrl+Z / Cmd+Z undoes the latest action.</p>
      <div class="waypoint-list">
        ${waypoints.length === 0 ? '<div class="empty-state">No route yet</div>' : ''}
        ${waypoints.map((waypoint, index) => this.waypointRow(waypoint.id, waypoint.name, waypoint.lat, waypoint.lon, index, waypoints.length)).join('')}
      </div>
    `;
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
      <article class="waypoint-card" data-id="${id}">
        <div class="waypoint-index">${index + 1}</div>
        <div class="waypoint-main">
          <div class="waypoint-topline">
            <span class="role-badge">${role}</span>
            <input class="waypoint-name" data-field="name" value="${this.escape(name)}" aria-label="Waypoint name" />
          </div>
          <div class="coords">${lat.toFixed(5)}° / ${lon.toFixed(5)}°</div>
          <div class="waypoint-planning-actions">${index < count - 1 ? `<button type="button" data-action="prepare">Prepare next leg</button>` : ''}<button type="button" data-action="visit" ${count < 2 ? 'disabled title="Add a destination first"' : ''}>${this.store.isAirportWaypoint(id) ? 'Airport / pattern' : 'Waypoint settings'}</button></div>
        </div>
        <div class="waypoint-actions">
          <button class="icon-button" data-action="up" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="icon-button" data-action="down" title="Move down" ${index === count - 1 ? 'disabled' : ''}>↓</button>
          <button class="icon-button danger" data-action="remove" title="Remove">×</button>
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
    if (action === 'remove') this.store.removeWaypoint(id);
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.dataset.field !== 'name') return;

    const card = input.closest<HTMLElement>('[data-id]');
    const id = card?.dataset.id;
    if (!id) return;

    this.store.updateWaypoint(id, { name: input.value.trim() || 'WP' });
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
