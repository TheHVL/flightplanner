import type {
  FlightPlanStore,
  VerticalProfileSettings,
  WaypointVerticalMode,
} from '../flightplan/FlightPlanStore';
import { findAipAerodrome, normalizeIcao } from '../aip/aerodromes';
import {
  calculateRouteVerticalProfile,
  type RouteVerticalEvent,
} from '../navigation/verticalProfile';

export class VerticalProfilePanel {
  private readonly aipStatus = new Map<string, string>();
  private loadingAipKey: string | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.element.addEventListener('click', (event) => void this.handleClick(event));
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
          waypointConstraints: constraints.map((constraint) => ({
            waypointId: constraint.waypointId,
            mode: constraint.mode,
            elevationFt: constraint.elevationFt,
          })),
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
    const totalCircuitMinutes = this.store.getTotalWaypointActivityMinutes();

    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PHASE 7 · AIP PREVIEW</p>
          <h2>Vertical profile &amp; aerodromes</h2>
        </div>
      </div>
      <p class="hint">TOC/TOD follows the planned level for each leg. A PL descent is never started before the waypoint where the lower outbound PL begins. Aerodrome elevation can be filled from the bundled Avinor AIP snapshot or entered manually.</p>
      <div class="vertical-input-grid">
        ${this.numberField(`${departureName} elevation`, 'dep-elev', settings.departureElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField(`${destinationName} elevation`, 'dest-elev', settings.destinationElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField('Climb rate', 'climb-rate', settings.climbRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Descent rate', 'descent-rate', settings.descentRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Climb groundspeed', 'climb-gs', settings.climbGroundSpeedKt, 'kt', 20, 300, 1)}
        ${this.numberField('Descent groundspeed', 'descent-gs', settings.descentGroundSpeedKt, 'kt', 20, 300, 1)}
      </div>
      ${this.endpointAipControls('departure', departureName, settings.departureIcaoCode, settings.departureElevationFt)}
      ${this.endpointAipControls('destination', destinationName, settings.destinationIcaoCode, settings.destinationElevationFt)}
      ${this.waypointControls(waypoints, plannedAltitudesFt)}
      ${totalCircuitMinutes > 0
        ? `<div class="vertical-circuit-total"><strong>Circuit allowance:</strong> ${this.minutesLabel(totalCircuitMinutes)} added to OFP accumulated time. Circuit fuel is not yet included.</div>`
        : ''}
      ${resultHtml}
      <div class="nav-help vertical-help"><strong>How it works:</strong> Auto follows the PL before and after a waypoint. A higher outbound PL creates a TOC after the waypoint. A lower outbound PL creates a TOD on the outbound leg, never before that waypoint. Airport/T&amp;G descends to field elevation and climbs again. Circuits does the same and also adds the selected pattern time to OFP accumulated time. Off suppresses automatic vertical events at that waypoint.</div>
    `;
  }

  private endpointAipControls(
    endpoint: 'departure' | 'destination',
    waypointName: string,
    storedCode: string,
    elevationFt: number,
  ): string {
    const suggested = storedCode || this.icaoSuggestion(waypointName);
    const statusKey = `endpoint:${endpoint}`;
    const status = this.aipStatus.get(statusKey);
    const loading = this.loadingAipKey === statusKey;
    return `
      <div class="vertical-aip-endpoint-row">
        <div>
          <strong>${endpoint === 'departure' ? 'Departure' : 'Destination'} AIP elevation</strong>
          <span>${this.escape(waypointName)} · current ${Math.round(elevationFt).toLocaleString()} ft</span>
        </div>
        <input
          class="vertical-aip-code"
          type="text"
          maxlength="4"
          placeholder="ICAO"
          value="${this.escape(suggested)}"
          data-aip-endpoint-code="${endpoint}"
          aria-label="${endpoint} ICAO code"
        />
        <button class="vertical-aip-button" type="button" data-aip-endpoint-lookup="${endpoint}" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Use AIP'}</button>
        ${status ? `<small class="vertical-aip-status">${this.escape(status)}</small>` : ''}
      </div>`;
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
          <span>Use AIP elevation for airport visits, or add a circuit/pattern allowance for training time.</span>
        </div>
        <div class="vertical-waypoint-list">
          ${waypoints.slice(1, -1).map((waypoint, offset) => {
            const waypointIndex = offset + 1;
            const inboundPl = plannedAltitudesFt[waypointIndex - 1];
            const outboundPl = plannedAltitudesFt[waypointIndex];
            const constraint = this.store.getWaypointVerticalConstraint(waypoint.id);
            const isAirportMode = constraint.mode === 'airport' || constraint.mode === 'circuits';
            const suggestedIcao = constraint.icaoCode || this.icaoSuggestion(waypoint.name);
            const statusKey = `waypoint:${waypoint.id}`;
            const status = this.aipStatus.get(statusKey);
            const loading = this.loadingAipKey === statusKey;
            return `
              <div class="vertical-waypoint-row vertical-waypoint-row--${constraint.mode}">
                <div class="vertical-waypoint-name">
                  <strong>${this.escape(waypoint.name)}</strong>
                  <span>PL ${this.altitudeLabel(inboundPl)} → ${this.altitudeLabel(outboundPl)}</span>
                </div>
                <select data-vertical-waypoint-mode="${waypoint.id}" aria-label="Vertical behavior at ${this.escape(waypoint.name)}">
                  <option value="auto" ${constraint.mode === 'auto' ? 'selected' : ''}>Auto from PL</option>
                  <option value="airport" ${constraint.mode === 'airport' ? 'selected' : ''}>Airport / T&amp;G</option>
                  <option value="circuits" ${constraint.mode === 'circuits' ? 'selected' : ''}>Airport + circuits</option>
                  <option value="none" ${constraint.mode === 'none' ? 'selected' : ''}>Off</option>
                </select>
                ${isAirportMode ? `
                  <div class="vertical-airport-tools">
                    <input class="vertical-aip-code" type="text" maxlength="4" placeholder="ICAO" value="${this.escape(suggestedIcao)}" data-vertical-waypoint-icao="${waypoint.id}" aria-label="ICAO code for ${this.escape(waypoint.name)}" />
                    <button class="vertical-aip-button" type="button" data-aip-waypoint-lookup="${waypoint.id}" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Use AIP'}</button>
                    <label class="vertical-airport-elevation"><input type="number" min="0" max="20000" step="10" placeholder="Elev" data-vertical-waypoint-elevation="${waypoint.id}" value="${constraint.elevationFt ?? ''}" /><span>ft</span></label>
                    ${status ? `<small class="vertical-aip-status">${this.escape(status)}</small>` : ''}
                  </div>` : ''}
                ${constraint.mode === 'circuits' ? `
                  <div class="vertical-circuit-controls">
                    <label><span>Circuits</span><input type="number" min="1" max="20" step="1" data-vertical-circuit-count="${waypoint.id}" value="${constraint.circuitCount}" /></label>
                    <label><span>Min / circuit</span><input type="number" min="1" max="30" step="0.5" data-vertical-circuit-minutes="${waypoint.id}" value="${constraint.minutesPerCircuit}" /></label>
                    <strong>+${this.minutesLabel(this.store.getWaypointActivityMinutes(waypoint.id))}</strong>
                  </div>` : ''}
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
      ? 'airport'
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

    const endpointCode = target.dataset.aipEndpointCode as 'departure' | 'destination' | undefined;
    if (endpointCode) {
      const value = normalizeIcao(target.value);
      this.store.updateVerticalProfileSettings(endpointCode === 'departure'
        ? { departureIcaoCode: value }
        : { destinationIcaoCode: value });
      return;
    }

    const waypointModeId = target.dataset.verticalWaypointMode;
    if (waypointModeId) {
      const mode = target.value as WaypointVerticalMode;
      this.store.setWaypointVerticalConstraint(waypointModeId, { mode });
      return;
    }

    const waypointIcaoId = target.dataset.verticalWaypointIcao;
    if (waypointIcaoId) {
      this.store.setWaypointVerticalConstraint(waypointIcaoId, { icaoCode: target.value });
      return;
    }

    const waypointElevationId = target.dataset.verticalWaypointElevation;
    if (waypointElevationId) {
      const value = target.value.trim() === '' ? null : Number(target.value);
      if (value !== null && !Number.isFinite(value)) return;
      this.store.setWaypointVerticalConstraint(waypointElevationId, { elevationFt: value });
      return;
    }

    const circuitCountId = target.dataset.verticalCircuitCount;
    if (circuitCountId) {
      const value = Number(target.value);
      if (Number.isFinite(value)) this.store.setWaypointVerticalConstraint(circuitCountId, { circuitCount: value });
      return;
    }

    const circuitMinutesId = target.dataset.verticalCircuitMinutes;
    if (circuitMinutesId) {
      const value = Number(target.value);
      if (Number.isFinite(value)) this.store.setWaypointVerticalConstraint(circuitMinutesId, { minutesPerCircuit: value });
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

  private async handleClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const endpointButton = target.closest<HTMLButtonElement>('[data-aip-endpoint-lookup]');
    if (endpointButton) {
      const endpoint = endpointButton.dataset.aipEndpointLookup as 'departure' | 'destination';
      await this.lookupEndpoint(endpoint);
      return;
    }

    const waypointButton = target.closest<HTMLButtonElement>('[data-aip-waypoint-lookup]');
    if (waypointButton) {
      const waypointId = waypointButton.dataset.aipWaypointLookup;
      if (waypointId) await this.lookupWaypoint(waypointId);
    }
  }

  private async lookupEndpoint(endpoint: 'departure' | 'destination'): Promise<void> {
    const settings = this.store.getVerticalProfileSettings();
    const waypoints = this.store.getWaypoints();
    const waypointName = endpoint === 'departure' ? waypoints[0]?.name : waypoints[waypoints.length - 1]?.name;
    const code = endpoint === 'departure'
      ? settings.departureIcaoCode || this.icaoSuggestion(waypointName ?? '')
      : settings.destinationIcaoCode || this.icaoSuggestion(waypointName ?? '');
    const statusKey = `endpoint:${endpoint}`;
    this.loadingAipKey = statusKey;
    this.render();

    try {
      const { aerodrome, catalog } = await findAipAerodrome(code);
      this.aipStatus.set(statusKey, `${aerodrome.icao} ${aerodrome.name}: ${aerodrome.elevationFt} ft · AIP ${catalog.effectiveDate || 'current snapshot'}`);
      this.store.updateVerticalProfileSettings(endpoint === 'departure'
        ? { departureIcaoCode: aerodrome.icao, departureElevationFt: aerodrome.elevationFt }
        : { destinationIcaoCode: aerodrome.icao, destinationElevationFt: aerodrome.elevationFt });
    } catch (error) {
      this.aipStatus.set(statusKey, error instanceof Error ? error.message : 'AIP lookup failed.');
    } finally {
      this.loadingAipKey = null;
      this.render();
    }
  }

  private async lookupWaypoint(waypointId: string): Promise<void> {
    const waypoint = this.store.getWaypoints().find((candidate) => candidate.id === waypointId);
    if (!waypoint) return;
    const constraint = this.store.getWaypointVerticalConstraint(waypointId);
    const code = constraint.icaoCode || this.icaoSuggestion(waypoint.name);
    const statusKey = `waypoint:${waypointId}`;
    this.loadingAipKey = statusKey;
    this.render();

    try {
      const { aerodrome, catalog } = await findAipAerodrome(code);
      this.aipStatus.set(statusKey, `${aerodrome.icao} ${aerodrome.name}: ${aerodrome.elevationFt} ft · AIP ${catalog.effectiveDate || 'current snapshot'}`);
      this.store.setWaypointVerticalConstraint(waypointId, {
        icaoCode: aerodrome.icao,
        elevationFt: aerodrome.elevationFt,
      });
    } catch (error) {
      this.aipStatus.set(statusKey, error instanceof Error ? error.message : 'AIP lookup failed.');
    } finally {
      this.loadingAipKey = null;
      this.render();
    }
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

  private icaoSuggestion(value: string): string {
    const normalized = normalizeIcao(value);
    return normalized.length === 4 ? normalized : '';
  }

  private altitudeLabel(value: number | null): string {
    return value === null ? '—' : `${Math.round(value).toLocaleString()} ft`;
  }

  private halfNm(value: number): string {
    return (Math.round(value * 2) / 2).toFixed(1);
  }

  private minutesLabel(value: number): string {
    if (Number.isInteger(value)) return `${value} min`;
    return `${value.toFixed(1)} min`;
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
