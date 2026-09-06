import type {
  FlightPlanStore,
  VerticalProfileSettings,
  WaypointVerticalMode,
} from '../flightplan/FlightPlanStore';
import {
  calculateRouteVerticalProfile,
  type RouteVerticalEvent,
} from '../navigation/verticalProfile';

export class VerticalProfilePanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.store.subscribe(() => this.render());
  }

  render(): void {
    const settings = this.store.getVerticalProfileSettings();
    const legs = this.store.getLegs();
    const waypoints = this.store.getWaypoints();
    const plannedAltitudesFt = legs.map((leg) => this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
    const constraints = this.store.getVerticalWaypointConstraints();

    let resultHtml = '<div class="vertical-empty">Add at least two waypoints to calculate the vertical profile.</div>';
    if (legs.length > 0) {
      try {
        const result = calculateRouteVerticalProfile({
          legs,
          plannedAltitudesFt,
          waypointConstraints: constraints.map((constraint) => ({ ...constraint, waypointId: constraint.waypointId })),
          ...settings,
        });

        const visibleEvents = result.events.filter((event) => event.onRoute);
        resultHtml = `
          <div class="vertical-overview">
            <div><span>TOC/TOD</span><strong>${visibleEvents.length}</strong></div>
            <div><span>Vertical flight</span><strong>${this.halfNm(result.verticalDistanceNm)} NM</strong></div>
            <div><span>Level flight</span><strong>${this.halfNm(result.levelDistanceNm)} NM</strong></div>
          </div>
          ${visibleEvents.length > 0
            ? `<div class="vertical-events">${visibleEvents.map((event) => this.eventRow(event)).join('')}</div>`
            : '<div class="vertical-empty">No climb or descent is currently required by the entered PL values and waypoint settings.</div>'}
          ${result.warnings.length > 0
            ? `<div class="vertical-warning-list">${result.warnings.map((warning) => `<div class="vertical-warning">${this.escape(warning)}</div>`).join('')}</div>`
            : ''}
        `;
      } catch (error) {
        resultHtml = `<div class="vertical-warning">${this.escape(error instanceof Error ? error.message : 'Vertical profile calculation failed.')}</div>`;
      }
    }

    const departureName = waypoints[0]?.name ?? 'Departure';
    const destinationName = waypoints[waypoints.length - 1]?.name ?? 'Destination';

    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PHASE 6 · AUTOMATIC</p>
          <h2>Vertical profile</h2>
        </div>
      </div>
      <p class="hint">TOC/TOD is created automatically whenever the planned level changes. Mark an intermediate waypoint as an airport/T&amp;G to descend to field elevation and climb again after the waypoint.</p>
      <div class="vertical-input-grid">
        ${this.numberField(`${departureName} elevation`, 'dep-elev', settings.departureElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField(`${destinationName} elevation`, 'dest-elev', settings.destinationElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField('Climb rate', 'climb-rate', settings.climbRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Descent rate', 'descent-rate', settings.descentRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Climb groundspeed', 'climb-gs', settings.climbGroundSpeedKt, 'kt', 20, 300, 1)}
        ${this.numberField('Descent groundspeed', 'descent-gs', settings.descentGroundSpeedKt, 'kt', 20, 300, 1)}
      </div>
      ${this.waypointControls(waypoints, plannedAltitudesFt)}
      ${resultHtml}
      <div class="nav-help vertical-help"><strong>How it works:</strong> Auto follows the PL before and after a waypoint. A higher outbound PL creates a TOC after the waypoint; a lower outbound PL creates a TOD before it. Airport/T&amp;G forces a descent to the entered field elevation, then a new climb to the outbound PL. Off suppresses automatic vertical events at that waypoint.</div>
    `;
  }

  private waypointControls(
    waypoints: ReturnType<FlightPlanStore['getWaypoints']>,
    plannedAltitudesFt: Array<number | null>,
  ): string {
    if (waypoints.length <= 2) return '';

    return `
      <div class="vertical-waypoint-section">
        <div class="vertical-section-title">
          <strong>Intermediate waypoint behavior</strong>
          <span>Choose where airport descents / touch-and-goes occur.</span>
        </div>
        <div class="vertical-waypoint-list">
          ${waypoints.slice(1, -1).map((waypoint, offset) => {
            const waypointIndex = offset + 1;
            const inboundPl = plannedAltitudesFt[waypointIndex - 1];
            const outboundPl = plannedAltitudesFt[waypointIndex];
            const constraint = this.store.getWaypointVerticalConstraint(waypoint.id);
            return `
              <div class="vertical-waypoint-row">
                <div class="vertical-waypoint-name">
                  <strong>${this.escape(waypoint.name)}</strong>
                  <span>PL ${this.altitudeLabel(inboundPl)} → ${this.altitudeLabel(outboundPl)}</span>
                </div>
                <select data-vertical-waypoint-mode="${waypoint.id}" aria-label="Vertical behavior at ${this.escape(waypoint.name)}">
                  <option value="auto" ${constraint.mode === 'auto' ? 'selected' : ''}>Auto from PL</option>
                  <option value="airport" ${constraint.mode === 'airport' ? 'selected' : ''}>Airport / T&amp;G</option>
                  <option value="none" ${constraint.mode === 'none' ? 'selected' : ''}>Off</option>
                </select>
                ${constraint.mode === 'airport'
                  ? `<label class="vertical-airport-elevation"><input type="number" min="0" max="20000" step="10" placeholder="Elev" data-vertical-waypoint-elevation="${waypoint.id}" value="${constraint.elevationFt ?? ''}" /><span>ft</span></label>`
                  : ''}
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  private eventRow(event: RouteVerticalEvent): string {
    const location = event.onRoute
      ? `${this.halfNm(event.distanceFromWaypointNm)} NM ${event.position} ${this.escape(event.waypointName)}`
      : event.type === 'TOC' ? 'Beyond plotted route' : 'Before plotted route';
    const reason = event.reason === 'airport'
      ? 'airport / T&G'
      : event.reason === 'pl-change'
        ? 'PL change'
        : event.reason;

    return `
      <div class="vertical-event-row vertical-event-row--${event.type.toLowerCase()}">
        <span class="vertical-event-badge">${event.type}</span>
        <div>
          <strong>${location}</strong>
          <small>${Math.round(event.altitudeFromFt).toLocaleString()} → ${Math.round(event.altitudeToFt).toLocaleString()} ft · ${Math.round(event.timeMin)} min · ${reason}</small>
        </div>
      </div>`;
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;

    const waypointModeId = target.dataset.verticalWaypointMode;
    if (waypointModeId) {
      const mode = target.value as WaypointVerticalMode;
      const existing = this.store.getWaypointVerticalConstraint(waypointModeId);
      this.store.setWaypointVerticalConstraint(
        waypointModeId,
        mode,
        mode === 'airport' ? existing.elevationFt : null,
      );
      return;
    }

    const waypointElevationId = target.dataset.verticalWaypointElevation;
    if (waypointElevationId) {
      const value = target.value.trim() === '' ? null : Number(target.value);
      if (value !== null && !Number.isFinite(value)) return;
      this.store.setWaypointVerticalConstraint(waypointElevationId, 'airport', value);
      return;
    }

    const field = target.dataset.verticalField;
    if (!field) return;
    const value = Number(target.value);
    if (!Number.isFinite(value)) return;

    const patch: Partial<VerticalProfileSettings> = {};
    if (field === 'dep-elev') patch.departureElevationFt = value;
    if (field === 'dest-elev') patch.destinationElevationFt = value;
    if (field === 'climb-rate') patch.climbRateFpm = value;
    if (field === 'descent-rate') patch.descentRateFpm = value;
    if (field === 'climb-gs') patch.climbGroundSpeedKt = value;
    if (field === 'descent-gs') patch.descentGroundSpeedKt = value;
    this.store.updateVerticalProfileSettings(patch);
  }

  private numberField(
    label: string,
    field: string,
    value: number,
    unit: string,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="vertical-field">
        <span>${this.escape(label)}</span>
        <div class="vertical-input-wrap">
          <input type="number" data-vertical-field="${field}" value="${value}" min="${min}" max="${max}" step="${step}" />
          <em>${unit}</em>
        </div>
      </label>`;
  }

  private altitudeLabel(value: number | null): string {
    return value === null ? '—' : `${Math.round(value).toLocaleString()} ft`;
  }

  private halfNm(value: number): string {
    return (Math.round(value * 2) / 2).toFixed(1);
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
