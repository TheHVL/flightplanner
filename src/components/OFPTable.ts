import { LEG_SELECTED, openLegEditor } from './legEditorEvents';
import { escapeHtml } from '../utils/html';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import {
  automaticVariationForLeg,
  roundVariationDeg,
} from '../navigation/magneticVariation';
import { trueToMagnetic } from '../navigation/wind';
import {
  ceilFuelUsageGal,
  ceilLegDistanceNm,
  formatPlanningMinutesLabel,
  formatPlanningTime,
} from '../presentation/planningRounding';
import {
  calculateFuelPlanForStore,
  FUEL_SETTINGS_CHANGED_EVENT,
  type FuelLegPlan,
  type PatternFuelPlan,
} from '../fuel/fuelPlanning';
import { isOfpTouchAndGoBoundary } from './ofpTouchAndGoBoundary';
import { forecastFreshness } from '../weather/forecastFreshness';

interface LegRowResult {
  html: string;
}

export class OFPTable {
  private selectedLeg = '';
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.element.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      const frequency = target.closest<HTMLElement>('[data-frequency-open-from]');
      const row = target.closest<HTMLElement>('tr[data-leg-from]');
      if (!row) return;
      const detail = { fromId: row.dataset.legFrom!, toId: row.dataset.legTo! };
      if (frequency) {
        window.dispatchEvent(new CustomEvent('flightplanner-select-frequency-leg', { detail }));
        openLegEditor({ ...detail, focus: 'frequency' });
      } else {
        const field = target.closest<HTMLElement>('[data-editor-field]')?.dataset.editorField;
        openLegEditor({ ...detail, focus: field === 'msa' ? 'msa' : 'pl' });
      }
    });
    window.addEventListener(LEG_SELECTED, event => {
      const { fromId, toId } = (event as CustomEvent<{fromId:string;toId:string}>).detail;
      this.selectedLeg = `${fromId}->${toId}`;
      for (const row of this.element.querySelectorAll<HTMLElement>('tr[data-leg-from]')) row.classList.toggle('ofp-row-selected', `${row.dataset.legFrom}->${row.dataset.legTo}` === this.selectedLeg);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.render());
      window.setInterval(() => { if (this.element.isConnected) this.refreshForecastWarning(); }, 60_000);
      document.addEventListener('visibilitychange', () => this.refreshForecastWarning());
    }
  }

  render(): void {
    const legs = this.store.getLegs();
    const settings = this.store.getNavigationSettings();
    const totalDistance = totalRouteDistanceNm(legs);
    const totalCircuitMinutes = this.store.getTotalWaypointActivityMinutes();
    const fuelPlan = calculateFuelPlanForStore(this.store);

    let accumulatedDistanceNm = 0;
    let accumulatedTimeMinutes = 0;
    let accumulatedFuelGal: number | null = 0;
    let accumulatedDisplayedFuelGal: number | null = 0;

    const rows: string[] = [];
    const remainingFuel = () => fuelPlan.totalFuelOnboardGal !== null && accumulatedFuelGal !== null
      ? fuelPlan.totalFuelOnboardGal - fuelPlan.startupTaxiTakeoffGal - accumulatedFuelGal : null;
    const appendPattern = (waypoint: ReturnType<FlightPlanStore['getWaypoints']>[number]) => {
      const pattern = fuelPlan.patterns.find(p => p.waypointId === waypoint.id);
      if (!pattern) return;
      accumulatedTimeMinutes += pattern.timeMin;
      accumulatedFuelGal = accumulatedFuelGal !== null && pattern.fuelGal !== null ? accumulatedFuelGal + pattern.fuelGal : null;
      accumulatedDisplayedFuelGal = accumulatedDisplayedFuelGal !== null && pattern.fuelGal !== null
        ? accumulatedDisplayedFuelGal + ceilFuelUsageGal(pattern.fuelGal) : null;
      rows.push(this.patternRow(waypoint.name, pattern, accumulatedTimeMinutes, accumulatedDisplayedFuelGal, remainingFuel()));
    };
    if (legs.length) appendPattern(legs[0].from);
    for (const [index, leg] of legs.entries()) {
      const legPlan = fuelPlan.legs[index];
      accumulatedDistanceNm += leg.distanceNm;
      accumulatedTimeMinutes += legPlan.flightTimeMin;
      accumulatedFuelGal = accumulatedFuelGal !== null && legPlan.legFuelGal !== null
        ? accumulatedFuelGal + legPlan.legFuelGal : null;
      accumulatedDisplayedFuelGal = accumulatedDisplayedFuelGal !== null && legPlan.legFuelGal !== null
        ? accumulatedDisplayedFuelGal + ceilFuelUsageGal(legPlan.legFuelGal) : null;
      rows.push(this.legRow(leg, legPlan, settings, accumulatedDistanceNm,
        accumulatedTimeMinutes, accumulatedDisplayedFuelGal, remainingFuel(), fuelPlan.startupTaxiTakeoffGal).html);
      appendPattern(leg.to);
    }

    this.element.innerHTML = `
      <div class="weather-status weather-freshness-warning" data-ofp-weather-warning role="status" aria-live="polite" hidden></div>
      <div class="ofp-heading">
        <div>
          <p class="eyebrow">OPERATIONAL FLIGHT PLAN</p>
          <h2>Navigation log</h2>
        </div>
        <div class="route-total">
          <span>Total route</span>
          <strong title="Exact calculated distance: ${totalDistance.toFixed(2)} NM; total display rounds up to the next whole NM">${ceilLegDistanceNm(totalDistance)} NM</strong>
        </div>
      </div>
      <p class="ofp-editor-hint">Click a flight row, level or frequency to open that leg in Prepare legs.</p>
      <div class="table-scroll">
        <table class="ofp-table">
          <thead>
            <tr class="ofp-group-row">
              <th rowspan="2">FROM</th>
              <th rowspan="2">TAS</th>
              <th rowspan="2">TT</th>
              <th rowspan="2">VAR</th>
              <th rowspan="2">MT</th>
              <th colspan="2">WIND</th>
              <th colspan="2">ACC</th>
              <th colspan="3">FUEL</th>
              <th rowspan="2">TO</th>
              <th colspan="2">ALTITUDE</th>
              <th rowspan="2">MH</th>
              <th colspan="3">INTERMEDIATE</th>
              <th rowspan="2">ETO</th>
              <th colspan="2">TIME</th>
              <th colspan="2">FUEL REMAINING</th>
              <th rowspan="2" title="Selected OFP channel. Use Select/Edit to choose in the sidebar. Confirm active channels with ATS.">FREQ</th>
            </tr>
            <tr class="ofp-subhead-row">
              <th>DIR/VEL</th><th>WCA</th>
              <th title="Accumulated route distance from departure">DIST</th>
              <th title="Accumulated route time including modeled climb/descent and planned pattern time">TIME</th>
              <th title="Cruise fuel flow in US gallons per hour for this leg">FF<br><span class="ofp-unit">GPH</span></th>
              <th title="Phase-aware fuel used on this leg">INT<br><span class="ofp-unit">GAL</span></th>
              <th title="Accumulated enroute fuel used, excluding startup/taxi/takeoff allowance">ACC<br><span class="ofp-unit">GAL</span></th>
              <th title="Manual minimum safe altitude for this leg">MSA</th><th title="Planned level for this leg">PL</th>
              <th>GS</th><th title="Distance for this leg">DIST</th><th title="Time for this flight leg including climb/descent; pattern time is on its own row">TIME</th>
              <th>ATO</th><th>DIFF</th>
              <th>EST</th><th>ACT</th>
            </tr>
          </thead>
          <tbody>
            ${legs.length === 0 ? '<tr><td colspan="25" class="table-empty">Add at least two waypoints to calculate a leg.</td></tr>' : rows.join('')}
          </tbody>
        </table>
      </div>
      <div class="table-legend">
        <span><i class="dot calculated-dot"></i> Calculated</span>
        <span><i class="dot pending-dot"></i> In-flight entries</span>
        <span>Leg DIST and total route distance round up to the next whole NM. Accumulated distance remains shown to nearest 0.5 NM · headings/WCA shown to whole degrees</span>
        <span>TAS shows cruise TAS when a cruise portion exists; an all-climb/descent row shows that phase TAS. GS is whole-leg effective GS from flown distance / flight time.</span>
        <span>Select one OFP channel per leg in Prepare legs. The OFP shows only your selection; suggestions and alternatives remain in the sidebar.</span>
        <span>MSA is entered manually. Use the ±1 NM map corridor to inspect terrain/obstacles.</span>
        <span class="msa-legend-warning">PL below entered MSA is highlighted.</span>
        <span>Fuel INT/ACC uses modeled cruise, climb and descent phases; pattern fuel appears on its own row where the required fuel-flow inputs are available.</span>
        <span>Displayed planning time rounds up to whole minutes. INT fuel rounds each row up to whole US gallons; ACC fuel sums those displayed INT entries, including pattern rows. Startup is separate. Trip and remaining fuel use unrounded consumption.</span>
        <span class="ofp-touch-and-go-legend"><i></i> Solid line = airport boundary after any pattern row and start of the next OFP sector.</span>
        ${totalCircuitMinutes > 0 ? `<span>Pattern time: +${this.formatActivityMinutes(totalCircuitMinutes)} in ACC TIME${fuelPlan.circuitFuelGal === null ? '; enter Pattern FF to include its fuel' : `; ${ceilFuelUsageGal(fuelPlan.circuitFuelGal)} gal included` }.</span>` : ''}
      </div>
    `;
    this.refreshForecastWarning();
  }

  private refreshForecastWarning(): void {
    const node = this.element.querySelector<HTMLElement>('[data-ofp-weather-warning]');
    if (!node) return;
    const freshness = forecastFreshness(this.store.getWeatherForecasts());
    node.hidden = !this.store.getWeatherSettings().useForecastWinds || !freshness.stale;
    node.textContent = `Forecast winds need review. ${freshness.message}`;
  }

  private legRow(
    leg: ReturnType<FlightPlanStore['getLegs']>[number],
    legPlan: FuelLegPlan,
    settings: ReturnType<FlightPlanStore['getNavigationSettings']>,
    accumulatedDistanceNm: number,
    accumulatedTimeMinutes: number,
    accumulatedFuelGal: number | null,
    estimatedRemainingGal: number | null,
    startupTaxiTakeoffGal: number,
  ): LegRowResult {
    const isTouchAndGoBoundary = isOfpTouchAndGoBoundary(
      this.store.getWaypointVerticalConstraint(leg.to.id).mode,
    );
    const boundaryClass = isTouchAndGoBoundary && this.store.getWaypointActivityMinutes(leg.to.id) === 0 ? 'ofp-touch-and-go-boundary' : '';

    try {
      if (legPlan.performanceError) throw new Error(`POH performance: ${legPlan.performanceError}`);

      const rawVariationDegEast = settings.automaticVariation
        ? automaticVariationForLeg(leg).variationDegEast
        : settings.variationDegEast;
      const variationDegEast = roundVariationDeg(rawVariationDegEast);
      const magneticTrack = trueToMagnetic(leg.trueTrackDeg, variationDegEast);
      const magneticHeading = trueToMagnetic(legPlan.trueHeadingDeg, variationDegEast);
      const variationLabel = `${Math.abs(variationDegEast)}°${variationDegEast >= 0 ? 'E' : 'W'}`;
      const plannedAltitudeFt = this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id);
      const manualMsaFt = this.store.getManualMsaFt(leg.from.id, leg.to.id);
      const belowMsa = plannedAltitudeFt !== null && manualMsaFt !== null && plannedAltitudeFt < manualMsaFt;
      const forecast = this.store.getLegWeatherForecast(leg.from.id, leg.to.id);
      const windTitle = legPlan.forecastWindActive && forecast
        ? `${forecast.source}; ${Math.round(forecast.altitudeFt)} ft; valid ${forecast.validTimeUtc}; OAT ${forecast.temperatureC.toFixed(1)}°C; ${forecast.modelSelection ? forecastFreshness([forecast]).message : ''}`
        : 'Manual wind input';
      const altitudeWarning = belowMsa
        ? `Warning: planned level ${plannedAltitudeFt} ft is below entered MSA ${manualMsaFt} ft.`
        : 'Planned level for this leg in feet';
      const performanceTitle = `Cruise performance at ${Math.round(legPlan.pressureAltitudeFt)} ft pressure-altitude proxy; OAT ${legPlan.oatC.toFixed(1)}°C (${legPlan.oatSource === 'forecast' ? 'route weather' : 'manual OAT fallback'}).`;
      const tasTitle = legPlan.displayPhase === 'cruise'
        ? `Displayed TAS is cruise TAS ${legPlan.cruiseTasKt.toFixed(0)} kt. ${performanceTitle}`
        : legPlan.displayPhase === 'climb'
          ? `This leg has no meaningful cruise portion, so TAS shows modeled climb TAS ${legPlan.tasKt.toFixed(0)} kt. Cruise TAS at PL would be ${legPlan.cruiseTasKt.toFixed(0)} kt.`
          : `This leg has no meaningful cruise portion, so TAS shows descent TAS ${legPlan.tasKt.toFixed(0)} kt. Cruise TAS at PL would be ${legPlan.cruiseTasKt.toFixed(0)} kt.`;
      const timeTitle = this.phaseTimeTitle(legPlan);
      const fuelTitle = this.phaseFuelTitle(legPlan);
      const accumulatedFuelTitle = accumulatedFuelGal === null
        ? 'Accumulated fuel is incomplete because one or more required phase fuel-flow inputs are missing.'
        : `Sum of displayed rounded INT fuel entries: ${accumulatedFuelGal} gal. Startup/taxi/takeoff allowance of ${startupTaxiTakeoffGal.toFixed(1)} gal is tracked separately. Trip and remaining fuel use unrounded consumption.`;
      const remainingTitle = estimatedRemainingGal === null
        ? 'Enter Fuel onboard and all required phase fuel flows to calculate estimated fuel remaining.'
        : `Estimated fuel remaining after this leg, including subtraction of ${startupTaxiTakeoffGal.toFixed(1)} gal startup/taxi/takeoff allowance.`;
      const gsTitle = `Effective whole-leg GS ${legPlan.groundSpeedKt.toFixed(1)} kt = ${leg.distanceNm.toFixed(2)} NM / ${legPlan.flightTimeMin.toFixed(2)} min of flying time. Pattern time is not included in GS. Cruise-only GS is ${legPlan.cruiseGroundSpeedKt.toFixed(1)} kt.`;

      return {
        html: `
        <tr class="${[belowMsa ? 'ofp-row-warning' : '', boundaryClass, this.selectedLeg === `${leg.from.id}->${leg.to.id}` ? 'ofp-row-selected' : ''].filter(Boolean).join(' ')}" data-leg-from="${leg.from.id}" data-leg-to="${leg.to.id}">
          <td><button type="button" class="ofp-leg-link" aria-label="Prepare leg ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}">${escapeHtml(leg.from.name)}</button></td>
          <td class="calculated" title="${tasTitle}">${legPlan.tasKt.toFixed(0)}</td>
          <td class="calculated">${this.headingLabel(leg.trueTrackDeg)}</td>
          <td class="calculated" title="${settings.automaticVariation ? `WMM2025 at leg midpoint: ${rawVariationDegEast.toFixed(2)}°, rounded for OFP` : 'Manual variation override'}">${variationLabel}</td>
          <td class="calculated">${this.headingLabel(magneticTrack)}</td>
          <td class="calculated" title="${escapeHtml(windTitle)}">${this.headingLabel(legPlan.windFromDeg)}/${Math.round(legPlan.windSpeedKt)}</td>
          <td class="calculated" title="Exact WCA for displayed ${legPlan.displayPhase} TAS: ${legPlan.wcaDeg.toFixed(2)}°">${this.signedDegrees(legPlan.wcaDeg)}</td>
          <td class="calculated" title="Exact accumulated distance: ${accumulatedDistanceNm.toFixed(2)} NM">${this.distanceLabel(accumulatedDistanceNm)}</td>
          <td class="calculated" title="Accumulated route time including modeled phase time">${this.formatMinutes(accumulatedTimeMinutes)}</td>
          ${legPlan.cruiseFuelFlowGph === null
            ? '<td class="pending" title="Enter Manual cruise FF when POH performance is disabled">—</td>'
            : `<td class="calculated" title="Cruise fuel flow. ${performanceTitle}">${legPlan.cruiseFuelFlowGph.toFixed(1)}</td>`}
          ${legPlan.legFuelGal === null
            ? `<td class="pending" title="${legPlan.phaseWarning ?? 'Fuel input incomplete'}">—</td>`
            : `<td class="calculated" title="${fuelTitle}">${ceilFuelUsageGal(legPlan.legFuelGal)}</td>`}
          ${accumulatedFuelGal === null
            ? `<td class="pending" title="${accumulatedFuelTitle}">—</td>`
            : `<td class="calculated" title="${accumulatedFuelTitle}">${ceilFuelUsageGal(accumulatedFuelGal)}</td>`}
          <td><strong>${escapeHtml(leg.to.name)}</strong></td>
          <td class="editable-cell ${belowMsa ? 'msa-warning-cell' : ''}">
            <button type="button" class="ofp-altitude-input ofp-edit-link" data-editor-field="msa" aria-label="Edit MSA ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}" title="Open this leg in Prepare legs">${manualMsaFt ?? 'Add'}</button>
          </td>
          <td class="editable-cell ${belowMsa ? 'pl-warning-cell' : ''}">
            <button type="button" class="ofp-altitude-input ofp-edit-link" data-editor-field="pl" aria-label="Edit planned altitude ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}" title="${altitudeWarning}">${plannedAltitudeFt ?? 'Add'}</button>
          </td>
          <td class="calculated">${this.headingLabel(magneticHeading)}</td>
          <td class="calculated" title="${gsTitle}">${legPlan.groundSpeedKt.toFixed(0)}</td>
          <td class="calculated" title="Exact leg distance: ${leg.distanceNm.toFixed(2)} NM; displayed leg distance is rounded upward to the next whole NM">${ceilLegDistanceNm(leg.distanceNm)}</td>
          <td class="calculated" title="${timeTitle}">${this.formatMinutes(legPlan.totalTimeMin)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          ${estimatedRemainingGal === null
            ? `<td class="pending" title="${remainingTitle}">—</td>`
            : `<td class="calculated ${estimatedRemainingGal < 0 ? 'fuel-negative' : ''}" title="${remainingTitle}">${estimatedRemainingGal.toFixed(1)}</td>`}
          <td class="pending">—</td>
          ${this.frequencyCell(leg)}
        </tr>`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation calculation failed.';
      return {
        html: `<tr class="${boundaryClass}" data-leg-from="${leg.from.id}" data-leg-to="${leg.to.id}"><td><strong>${escapeHtml(leg.from.name)}</strong></td><td colspan="23" class="calculation-error">${escapeHtml(message)}</td>${this.frequencyCell(leg)}</tr>`,
      };
    }
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const msaFromId = input.dataset.msaFrom;
    const msaToId = input.dataset.msaTo;
    if (msaFromId && msaToId) {
      if (input.value.trim() === '') {
        this.store.setManualMsaFt(msaFromId, msaToId, null);
        return;
      }
      const msaFt = Number(input.value);
      if (Number.isFinite(msaFt)) this.store.setManualMsaFt(msaFromId, msaToId, msaFt);
      return;
    }

    const fromId = input.dataset.altFrom;
    const toId = input.dataset.altTo;
    if (!fromId || !toId) return;

    if (input.value.trim() === '') {
      this.store.setPlannedAltitudeFt(fromId, toId, null);
      return;
    }

    const altitudeFt = Number(input.value);
    if (!Number.isFinite(altitudeFt)) return;
    this.store.setPlannedAltitudeFt(fromId, toId, altitudeFt);
  }

  private frequencyCell(leg: ReturnType<FlightPlanStore['getLegs']>[number]): string {
    const selected = this.store.getManualFrequency(leg.from.id, leg.to.id);
    return `<td class="ofp-frequency-cell">${selected ? `<strong>${escapeHtml(selected)}</strong>` : '<span class="pending">—</span>'}<button type="button" class="ofp-frequency-link" data-frequency-open-from="${escapeHtml(leg.from.id)}" data-frequency-open-to="${escapeHtml(leg.to.id)}" aria-label="${selected ? 'Edit' : 'Select'} frequency ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}">${selected ? 'Edit' : 'Select'}</button></td>`;
  }

  private patternRow(name: string, pattern: PatternFuelPlan, totalMinutes: number, accumulatedFuel: number | null, remaining: number | null): string {
    const cells = Array.from({ length: 25 }, () => '<td class="pattern-blank"></td>');
    const fuelCell = (value: number | null, title: string) => value === null
      ? `<td class="pending" title="${escapeHtml(title)}">—</td>`
      : `<td class="calculated" title="${escapeHtml(title)}">${ceilFuelUsageGal(value)}</td>`;
    cells[0] = `<td><strong>${escapeHtml(name)}</strong><small class="ofp-pattern-label">Pattern × ${pattern.patternCount}</small></td>`;
    cells[8] = `<td class="calculated" title="Accumulated flight and pattern time">${this.formatMinutes(totalMinutes)}</td>`;
    cells[9] = pattern.fuelFlowGph === null ? '<td class="pending" title="Enter Pattern FF in Cruise performance &amp; fuel">—</td>' : `<td class="calculated" title="Pattern fuel flow in US gallons per hour">${pattern.fuelFlowGph.toFixed(1)}</td>`;
    cells[10] = fuelCell(pattern.fuelGal, pattern.fuelGal === null ? 'Enter Pattern FF to include pattern fuel.' : `Pattern fuel ${pattern.fuelGal.toFixed(2)} gal = ${pattern.patternCount} × ${pattern.minutesPerPattern} min × ${pattern.fuelFlowGph} GPH / 60.`);
    cells[11] = fuelCell(accumulatedFuel, 'Sum of displayed rounded INT fuel entries, including patterns; excluding startup/taxi/takeoff. Trip and remaining fuel use unrounded consumption.');
    cells[18] = `<td class="calculated" title="${pattern.patternCount} × ${pattern.minutesPerPattern} minutes">${this.formatMinutes(pattern.timeMin)}</td>`;
    cells[22] = remaining === null ? '<td class="pending">—</td>' : `<td class="calculated ${remaining < 0 ? 'fuel-negative' : ''}" title="Estimated fuel remaining after pattern">${remaining.toFixed(1)}</td>`;
    return `<tr class="ofp-pattern-row ofp-touch-and-go-boundary" data-pattern-waypoint="${escapeHtml(pattern.waypointId)}">${cells.join('')}</tr>`;
  }

  private phaseTimeTitle(leg: FuelLegPlan): string {
    const parts = [
      `cruise ${this.formatMinutes(leg.cruiseTimeMin)}`,
      leg.climbTimeMin > 0 ? `climb ${this.formatMinutes(leg.climbTimeMin)} at ${leg.climbTasKt?.toFixed(0) ?? '—'} KTAS` : '',
      leg.descentTimeMin > 0 ? `descent ${this.formatMinutes(leg.descentTimeMin)} at ${leg.descentTasKt?.toFixed(0) ?? '—'} KTAS` : '',
    ].filter(Boolean);
    return `Phase-aware leg time: ${parts.join(', ')}.`;
  }

  private phaseFuelTitle(leg: FuelLegPlan): string {
    const component = (name: string, value: number | null) => value === null ? `${name} needs FF` : `${name} ${ceilFuelUsageGal(value)} gal`;
    return [
      component('cruise', leg.cruiseFuelGal),
      leg.climbTimeMin > 0 ? component('climb', leg.climbFuelGal) : '',
      leg.descentTimeMin > 0 ? component('descent', leg.descentFuelGal) : '',
    ].filter(Boolean).join(', ');
  }

  private headingLabel(value: number): string {
    const rounded = ((Math.round(value) % 360) + 360) % 360;
    return `${String(rounded).padStart(3, '0')}°`;
  }

  private signedDegrees(value: number): string {
    const rounded = Math.sign(value) * Math.round(Math.abs(value));
    return `${rounded > 0 ? '+' : ''}${rounded}°`;
  }

  private distanceLabel(valueNm: number): string {
    return (Math.round(valueNm * 2) / 2).toFixed(1);
  }

  private formatMinutes(minutes: number): string {
    return formatPlanningTime(minutes);
  }

  private formatActivityMinutes(minutes: number): string {
    return formatPlanningMinutesLabel(minutes);
  }
}
