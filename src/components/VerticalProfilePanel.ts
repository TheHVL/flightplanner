import { setPanelMarkup } from '../utils/panelMarkup';
import type {
  FlightPlanStore,
  VerticalProfileSettings,
  WaypointVerticalMode,
} from '../flightplan/FlightPlanStore';
import { findAipAerodrome, normalizeIcao } from '../aip/aerodromes';
import {
  FUEL_SETTINGS_CHANGED_EVENT,
  getFuelPlanningSettings,
  saveFuelPlanningSettings,
} from '../fuel/fuelPlanning';
import {
  calculateRouteVerticalProfile,
  type ClimbPerformanceMode,
  type RouteVerticalEvent,
} from '../navigation/verticalProfile';
import {
  calculateVerticalProfileConflicts,
  formatVerticalConflict,
  verticalConflictAdvice,
} from '../navigation/verticalConflicts';
import {
  ceilFuelUsageGal,
  formatPlanningMinutesLabel,
} from '../presentation/planningRounding';

export class VerticalProfilePanel {
  private readonly aipStatus = new Map<string, string>();
  private loadingAipKey: string | null = null;
  private selectedWaypointId = '';

  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
    private readonly view: 'full' | 'settings' | 'profile' | 'waypoint' = 'full',
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.element.addEventListener('click', (event) => void this.handleClick(event));
    this.store.subscribe(() => this.render());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.render());
    if (view === 'waypoint') window.addEventListener('flightplanner-select-waypoint-visit', event => {
      this.selectedWaypointId = (event as CustomEvent<{ waypointId: string }>).detail.waypointId;
      this.render();
    });
  }

  render(): void {
    const settings = this.store.getVerticalProfileSettings();
    const performanceSettings = this.store.getPerformanceSettings();
    const fuelSettings = getFuelPlanningSettings();
    const legs = this.store.getLegs();
    const waypoints = this.store.getWaypoints();
    const plannedAltitudesFt = legs.map((leg) => this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
    const constraints = this.store.getVerticalWaypointConstraints();

    if (this.view === 'waypoint') {
      const point = waypoints.find(p => p.id === this.selectedWaypointId);
      if (!point) { setPanelMarkup(this.element, '<p class="hint">Choose a waypoint in the route to prepare an airport visit.</p>'); return; }
      const title = this.element.closest('details[data-leg-visit]')?.querySelector('[data-leg-visit-title]');
      if (title) title.textContent = `Airport / pattern · ${point.name}`;
      const index = waypoints.indexOf(point);
      if (index === 0 || index === waypoints.length - 1) {
        const endpoint = index === 0 ? 'departure' : 'destination';
        const elevation = index === 0 ? settings.departureElevationFt : settings.destinationElevationFt;
        const code = index === 0 ? settings.departureIcaoCode : settings.destinationIcaoCode;
        setPanelMarkup(this.element, `<h3 class="menu-group-title">${this.escape(point.name)} · ${endpoint}</h3><div class="vertical-input-grid">${this.numberField('Field elevation', index === 0 ? 'dep-elev' : 'dest-elev', elevation, 'ft', 0, 20000, 10)}</div>${this.endpointAipControls(endpoint, point.name, code, elevation)}${index === waypoints.length - 1 ? this.arrivalPatternControls(waypoints) : '<p class="menu-note">The departure climb starts at this field elevation.</p>'}`);
      } else {
        setPanelMarkup(this.element, this.waypointControls(waypoints, plannedAltitudesFt, point.id));
      }
      return;
    }

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
          climbPerformanceMode: fuelSettings.climbPerformanceMode,
          climbOatC: performanceSettings.oatC,
        });

        const visibleEvents = result.events.filter((event) => event.onRoute);
        const conflicts = calculateVerticalProfileConflicts(result);
        resultHtml = `
          <div class="vertical-overview">
            <div><span>TOC/TOD</span><strong>${visibleEvents.length}</strong></div>
            <div><span>Vertical flight</span><strong>${this.halfNm(result.verticalDistanceNm)} NM</strong></div>
            <div><span>Level flight</span><strong>${this.halfNm(result.levelDistanceNm)} NM</strong></div>
          </div>
          ${conflicts.length > 0
            ? `<div class="vertical-conflict-panel">
                <div class="vertical-conflict-heading">
                  <span>VERTICAL PROFILE CONFLICT</span>
                  <strong>${this.halfNm(result.overlapDistanceNm)} NM total overlap</strong>
                </div>
                ${conflicts.map((conflict, index) => `
                  <div class="vertical-conflict-item">
                    <strong>Conflict ${index + 1}: ${this.escape(formatVerticalConflict(conflict))}</strong>
                    <small>Route section ${this.halfNm(conflict.startNm)}-${this.halfNm(conflict.endNm)} NM from departure.</small>
                    <p>${this.escape(verticalConflictAdvice(conflict))}</p>
                  </div>
                `).join('')}
              </div>`
            : ''}
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
    const manualClimb = fuelSettings.climbPerformanceMode === 'manual';

    setPanelMarkup(this.element, `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">FLIGHT PROFILE</p>
          <h2>Climb &amp; descent profile</h2>
        </div>
      </div>
      <p class="hint">Set climb and descent performance, then check airport elevations and intermediate visits.</p>
      <h3 class="menu-group-title">Climb &amp; descent</h3>
      <label class="vertical-climb-model">
        <span>Climb performance</span>
        <select data-climb-performance-mode aria-label="Climb performance model">
          <option value="poh-normal-90" ${fuelSettings.climbPerformanceMode === 'poh-normal-90' ? 'selected' : ''}>POH normal · 90 KIAS</option>
          <option value="poh-max-rate" ${fuelSettings.climbPerformanceMode === 'poh-max-rate' ? 'selected' : ''}>POH maximum rate</option>
          <option value="manual" ${fuelSettings.climbPerformanceMode === 'manual' ? 'selected' : ''}>Manual rate / TAS</option>
        </select>
      </label>
      <div class="vertical-input-grid">
        ${manualClimb ? this.numberField('Climb rate', 'climb-rate', settings.climbRateFpm, 'ft/min', 100, 5000, 50) : ''}
        ${this.numberField('Descent rate', 'descent-rate', settings.descentRateFpm, 'ft/min', 100, 5000, 50)}
        ${manualClimb ? this.numberField('Manual climb TAS', 'climb-gs', settings.climbGroundSpeedKt, 'kt', 20, 300, 1) : ''}
        ${manualClimb ? this.nullableNumberField('Manual climb FF', 'climb-ff', fuelSettings.climbFuelFlowGph, 'GPH', 0, 40, 0.1) : ''}
        ${this.numberField('Descent TAS', 'descent-gs', settings.descentGroundSpeedKt, 'kt', 20, 300, 1)}
      </div>
      <details class="menu-subsection" data-menu-section="airport-elevations" open><summary>Departure &amp; arrival elevations</summary>
      <div class="vertical-input-grid">
        ${this.numberField(`${departureName} elevation`, 'dep-elev', settings.departureElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField(`${destinationName} elevation`, 'dest-elev', settings.destinationElevationFt, 'ft', 0, 20000, 10)}
      </div>
      ${this.endpointAipControls('departure', departureName, settings.departureIcaoCode, settings.departureElevationFt)}
      ${this.endpointAipControls('destination', destinationName, settings.destinationIcaoCode, settings.destinationElevationFt)}
      </details>
      ${waypoints.length > 2 ? `<details class="menu-subsection" data-menu-section="airport-visits"><summary>Intermediate airport visits &amp; pattern</summary>${this.waypointControls(waypoints, plannedAltitudesFt)}</details>` : ''}
      ${this.arrivalPatternControls(waypoints)}
      ${totalCircuitMinutes > 0
        ? `<div class="vertical-circuit-total"><strong>Pattern time:</strong> ${this.minutesLabel(totalCircuitMinutes)} shown on separate OFP rows and included in accumulated time. Fuel is included when Pattern FF is entered in the fuel panel.</div>`
        : ''}
      ${resultHtml}
      <details class="menu-help" data-menu-section="profile-help"><summary>Performance source &amp; profile rules</summary>
      ${manualClimb
        ? '<div class="vertical-poh-note"><strong>Manual climb:</strong> climb time uses the selected rate. The entered climb TAS is combined with the active leg wind to place TOC. Enter Manual climb FF below to include climb fuel. The same value is also available in Cruise performance &amp; fuel.</div>'
        : `<div class="vertical-poh-note"><strong>POH Figure 5-8:</strong> 3100 lb, flaps up, 2400 RPM, full throttle, mixture at Maximum Power Fuel Flow placard, cowl flaps OPEN. The POH table gives zero-wind air distance, time and fuel. Flightplanner derives average climb TAS from air distance/time, then applies the active per-leg wind to place TOC on the ground track. Time/fuel/distance are increased 10% for each 10°C above ISA, using route-weather OAT where available and manual OAT as fallback. ${fuelSettings.climbPerformanceMode === 'poh-normal-90' ? 'Normal climb is published through 10,000 ft.' : 'Maximum-rate climb is published through 14,000 ft.'}</div>`}
      <div class="nav-help vertical-help"><strong>How it works:</strong> Auto follows the PL before and after a waypoint. A higher outbound PL creates a TOC after the waypoint. If the previous climb is still in progress, it continues into this leg before the next altitude increment; the climb is never counted twice. A lower outbound PL creates a TOD before the waypoint, reaching the lower level before that leg begins. POH climb time/fuel stay tied to Figure 5-8 while wind changes the ground position of TOC. Descent time uses the selected rate, and descent TAS plus active wind sets the TOD ground distance. Airport/T&amp;G descends to field elevation and climbs again. Pattern does the same and adds a separate OFP row for the selected time and fuel. Off suppresses automatic vertical events at that waypoint. Until QNH conversion is added, entered elevations and PL are used as pressure-altitude proxies for POH climb calculations.</div></details>
    `);
    if (this.view === 'profile') {
      setPanelMarkup(this.element, `<div class="panel-heading"><h2>Climb &amp; descent review</h2></div><p class="hint">Review the profile below. Edit airport elevations and pattern in Prepare legs; performance defaults are in Settings.</p>${totalCircuitMinutes ? `<p class="menu-note">Pattern time: ${this.minutesLabel(totalCircuitMinutes)}, included in the OFP.</p>` : ''}${resultHtml}`);
    } else if (this.view === 'settings') {
      for (const node of this.element.querySelectorAll('[data-menu-section="airport-elevations"], [data-menu-section="airport-visits"], [data-menu-section="arrival-pattern"], .vertical-circuit-total, .vertical-overview, .vertical-events, .vertical-warning-list, .vertical-conflict-panel, .vertical-empty')) node.remove();
      this.element.querySelector('h2')!.textContent = 'Climb & descent defaults';
      this.element.querySelector('.hint')!.textContent = 'These performance settings apply to the whole flight. Prepare airport visits beside the waypoint in Prepare legs.';
    }
  }

  private arrivalPatternControls(waypoints: ReturnType<FlightPlanStore['getWaypoints']>): string {
    if (waypoints.length < 2) return '';
    const point = waypoints[waypoints.length - 1];
    const constraint = this.store.getWaypointVerticalConstraint(point.id);
    return `<details class="menu-subsection" data-menu-section="arrival-pattern"><summary>Arrival pattern · ${this.escape(point.name)}</summary>
      <label class="vertical-climb-model"><span>After arrival</span><select data-vertical-waypoint-mode="${point.id}" aria-label="Arrival pattern">
        <option value="auto" ${constraint.mode !== 'circuits' ? 'selected' : ''}>No planned pattern</option>
        <option value="circuits" ${constraint.mode === 'circuits' ? 'selected' : ''}>Add pattern</option>
      </select></label>
      ${constraint.mode === 'circuits' ? `<div class="vertical-circuit-controls">
        <label><span>Patterns</span><input type="number" min="1" max="20" step="1" data-vertical-circuit-count="${point.id}" value="${constraint.circuitCount}" /></label>
        <label><span>Min / pattern</span><input type="number" min="1" max="30" step="0.5" data-vertical-circuit-minutes="${point.id}" value="${constraint.minutesPerCircuit}" /></label>
      </div><p class="menu-note">Pattern time and fuel are added after the arrival leg. Arrival elevation above sets the descent endpoint.</p>` : ''}
    </details>`;
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
    selectedId?: string,
  ): string {
    if (waypoints.length <= 2) return '';

    return `
      <div class="vertical-waypoint-section">
        <div class="vertical-section-title">
          <strong>Intermediate waypoint behavior</strong>
          <span>Use AIP elevation for airport visits, or add pattern time for training time.</span>
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
            if (selectedId && waypoint.id !== selectedId) return '';
            return `
              <div class="vertical-waypoint-row vertical-waypoint-row--${constraint.mode}">
                <div class="vertical-waypoint-name">
                  <strong>${this.escape(waypoint.name)}</strong>
                  <span>PL ${this.altitudeLabel(inboundPl)} → ${this.altitudeLabel(outboundPl)}</span>
                </div>
                <select data-vertical-waypoint-mode="${waypoint.id}" aria-label="Vertical behavior at ${this.escape(waypoint.name)}">
                  <option value="auto" ${constraint.mode === 'auto' ? 'selected' : ''}>Auto from PL</option>
                  <option value="airport" ${constraint.mode === 'airport' ? 'selected' : ''}>Airport / T&amp;G</option>
                  <option value="circuits" ${constraint.mode === 'circuits' ? 'selected' : ''}>Airport + pattern</option>
                  <option value="none" ${constraint.mode === 'none' ? 'selected' : ''}>Off</option>
                </select>
                ${isAirportMode ? `
                  <div class="vertical-airport-tools">
                    <input class="vertical-aip-code" type="text" maxlength="4" placeholder="ICAO" value="${this.escape(suggestedIcao)}" data-vertical-waypoint-icao="${waypoint.id}" aria-label="ICAO code for ${this.escape(waypoint.name)}" />
                    <button class="vertical-aip-button" type="button" data-aip-waypoint-lookup="${waypoint.id}" ${loading ? 'disabled' : ''}>${loading ? 'Loading…' : 'Use AIP'}</button>
                    <label class="vertical-airport-elevation"><input type="number" min="0" max="20000" step="10" aria-label="Field elevation at ${this.escape(waypoint.name)}" placeholder="Elev" data-vertical-waypoint-elevation="${waypoint.id}" value="${constraint.elevationFt ?? ''}" /><span>ft</span></label>
                    ${status ? `<small class="vertical-aip-status">${this.escape(status)}</small>` : ''}
                  </div>` : ''}
                ${constraint.mode === 'circuits' ? `
                  <div class="vertical-circuit-controls">
                    <label><span>Patterns</span><input type="number" min="1" max="20" step="1" data-vertical-circuit-count="${waypoint.id}" value="${constraint.circuitCount}" /></label>
                    <label><span>Min / pattern</span><input type="number" min="1" max="30" step="0.5" data-vertical-circuit-minutes="${waypoint.id}" value="${constraint.minutesPerCircuit}" /></label>
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
    const source = event.type === 'TOC'
      ? event.performanceSource === 'poh-normal-90'
        ? 'POH normal 90 KIAS'
        : event.performanceSource === 'poh-max-rate'
          ? 'POH max rate'
          : 'manual climb'
      : 'manual descent';
    const fuel = event.fuelGal === null ? '' : ` · ${ceilFuelUsageGal(event.fuelGal)} gal`;
    const zeroWind = event.zeroWindDistanceNm === null ? '' : ` · POH zero-wind ${event.zeroWindDistanceNm.toFixed(1)} NM`;

    return `
      <div class="vertical-event-row vertical-event-row--${event.type.toLowerCase()}">
        <span class="vertical-event-badge">${event.type}</span>
        <div>
          <strong>${location}</strong>
          <small>${Math.round(event.altitudeFromFt).toLocaleString()} → ${Math.round(event.altitudeToFt).toLocaleString()} ft · ${formatPlanningMinutesLabel(event.timeMin)}${fuel} · ${Math.round(event.phaseTasKt)} KTAS${zeroWind} · ${reason} · ${source}</small>
        </div>
      </div>`;
  }

  private handleChange(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;

    if (target.dataset.climbPerformanceMode !== undefined) {
      const mode = target.value as ClimbPerformanceMode;
      const current = getFuelPlanningSettings();
      saveFuelPlanningSettings({ ...current, climbPerformanceMode: mode });
      return;
    }

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

    if (field === 'climb-ff') {
      const value = target.value.trim() === '' ? null : Number(target.value);
      if (value !== null && !Number.isFinite(value)) return;
      const current = getFuelPlanningSettings();
      saveFuelPlanningSettings({ ...current, climbFuelFlowGph: value });
      return;
    }

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

  private nullableNumberField(
    label: string,
    field: string,
    value: number | null,
    unit: string,
    min: number,
    max: number,
    step: number,
  ): string {
    return `
      <label class="vertical-field">
        <span>${this.escape(label)}</span>
        <div class="vertical-input-wrap">
          <input type="number" data-vertical-field="${field}" value="${value ?? ''}" min="${min}" max="${max}" step="${step}" placeholder="optional" />
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
    return formatPlanningMinutesLabel(value);
  }

  private escape(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('"', '&quot;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }
}
