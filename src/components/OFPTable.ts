import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import {
  automaticVariationForLeg,
  roundVariationDeg,
} from '../navigation/magneticVariation';
import { trueToMagnetic } from '../navigation/wind';
import {
  calculateFuelPlanForStore,
  FUEL_SETTINGS_CHANGED_EVENT,
  type FuelLegPlan,
} from '../fuel/fuelPlanning';

interface LegRowResult {
  html: string;
}

export class OFPTable {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    if (typeof window !== 'undefined') {
      window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.render());
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

    const rows = legs.map((leg, index) => {
      const legPlan = fuelPlan.legs[index];
      accumulatedDistanceNm += leg.distanceNm;
      accumulatedTimeMinutes += legPlan.totalTimeMin;
      accumulatedFuelGal = accumulatedFuelGal !== null && legPlan.legFuelGal !== null
        ? accumulatedFuelGal + legPlan.legFuelGal
        : null;
      const estimatedRemainingGal = fuelPlan.totalFuelOnboardGal !== null && accumulatedFuelGal !== null
        ? fuelPlan.totalFuelOnboardGal - fuelPlan.startupTaxiTakeoffGal - accumulatedFuelGal
        : null;

      return this.legRow(
        leg,
        legPlan,
        settings,
        accumulatedDistanceNm,
        accumulatedTimeMinutes,
        accumulatedFuelGal,
        estimatedRemainingGal,
        fuelPlan.startupTaxiTakeoffGal,
      ).html;
    });

    this.element.innerHTML = `
      <div class="ofp-heading">
        <div>
          <p class="eyebrow">OPERATIONAL FLIGHT PLAN</p>
          <h2>Navigation log</h2>
        </div>
        <div class="route-total">
          <span>Total route</span>
          <strong title="Exact calculated distance: ${totalDistance.toFixed(2)} NM">${this.distanceLabel(totalDistance)} NM</strong>
        </div>
      </div>
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
              <th rowspan="2">FREQ</th>
            </tr>
            <tr class="ofp-subhead-row">
              <th>DIR/VEL</th><th>WCA</th>
              <th title="Accumulated route distance from departure">DIST</th>
              <th title="Accumulated route time including modeled climb/descent and configured circuit/pattern allowances">TIME</th>
              <th title="Cruise fuel flow in US gallons per hour for this leg">FF<br><span class="ofp-unit">GPH</span></th>
              <th title="Phase-aware fuel used on this leg">INT<br><span class="ofp-unit">GAL</span></th>
              <th title="Accumulated enroute fuel used, excluding startup/taxi/takeoff allowance">ACC<br><span class="ofp-unit">GAL</span></th>
              <th title="Manual minimum safe altitude for this leg">MSA</th><th title="Planned level for this leg">PL</th>
              <th>GS</th><th title="Distance for this leg">DIST</th><th title="Time for this leg including climb/descent and activity time">TIME</th>
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
        <span><i class="dot pending-dot"></i> Added in later phases</span>
        <span>Distances shown to nearest 0.5 NM · headings/WCA shown to whole degrees</span>
        <span>TAS shows cruise TAS when a cruise portion exists; an all-climb/descent row shows that phase TAS. GS is whole-leg effective GS from flown distance / flight time.</span>
        <span>MSA is entered manually. Use the ±1 NM map corridor to inspect terrain/obstacles.</span>
        <span class="msa-legend-warning">PL below entered MSA is highlighted.</span>
        <span>Fuel INT/ACC uses modeled cruise, climb, descent and circuit phases where the required fuel-flow inputs are available.</span>
        ${totalCircuitMinutes > 0 ? `<span>Circuit/pattern allowance: +${this.formatActivityMinutes(totalCircuitMinutes)} in ACC TIME${fuelPlan.circuitFuelGal === null ? '; enter Circuit FF to include its fuel' : `; ${fuelPlan.circuitFuelGal.toFixed(2)} gal included` }.</span>` : ''}
      </div>
    `;
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
        ? `${forecast.source}; ${Math.round(forecast.altitudeFt)} ft; ${new Date(forecast.validTimeUtc).toISOString().slice(11, 16)}Z; OAT ${forecast.temperatureC.toFixed(1)}°C`
        : 'Manual wind input';
      const altitudeWarning = belowMsa
        ? `Warning: planned level ${plannedAltitudeFt} ft is below entered MSA ${manualMsaFt} ft.`
        : 'Planned level for this leg in feet';
      const performanceTitle = `Cruise performance at ${Math.round(legPlan.pressureAltitudeFt)} ft pressure-altitude proxy; OAT ${legPlan.oatC.toFixed(1)}°C (${legPlan.oatSource === 'forecast' ? 'route weather' : 'Phase 4 fallback'}).`;
      const tasTitle = legPlan.displayPhase === 'cruise'
        ? `Displayed TAS is cruise TAS ${legPlan.cruiseTasKt.toFixed(0)} kt. ${performanceTitle}`
        : legPlan.displayPhase === 'climb'
          ? `This leg has no meaningful cruise portion, so TAS shows modeled climb TAS ${legPlan.tasKt.toFixed(0)} kt. Cruise TAS at PL would be ${legPlan.cruiseTasKt.toFixed(0)} kt.`
          : `This leg has no meaningful cruise portion, so TAS shows descent TAS ${legPlan.tasKt.toFixed(0)} kt. Cruise TAS at PL would be ${legPlan.cruiseTasKt.toFixed(0)} kt.`;
      const timeTitle = this.phaseTimeTitle(legPlan);
      const fuelTitle = this.phaseFuelTitle(legPlan);
      const accumulatedFuelTitle = accumulatedFuelGal === null
        ? 'Accumulated fuel is incomplete because one or more required phase fuel-flow inputs are missing.'
        : `Accumulated enroute fuel ${accumulatedFuelGal.toFixed(2)} gal. Startup/taxi/takeoff allowance of ${startupTaxiTakeoffGal.toFixed(1)} gal is tracked separately.`;
      const remainingTitle = estimatedRemainingGal === null
        ? 'Enter Fuel onboard and all required phase fuel flows to calculate estimated fuel remaining.'
        : `Estimated fuel remaining after this leg, including subtraction of ${startupTaxiTakeoffGal.toFixed(1)} gal startup/taxi/takeoff allowance.`;
      const gsTitle = `Effective whole-leg GS ${legPlan.groundSpeedKt.toFixed(1)} kt = ${leg.distanceNm.toFixed(2)} NM / ${legPlan.flightTimeMin.toFixed(2)} min of flying time. Circuit/activity time is not included in GS. Cruise-only GS is ${legPlan.cruiseGroundSpeedKt.toFixed(1)} kt.`;

      return {
        html: `
        <tr class="${belowMsa ? 'ofp-row-warning' : ''}">
          <td><strong>${leg.from.name}</strong></td>
          <td class="calculated" title="${tasTitle}">${legPlan.tasKt.toFixed(0)}</td>
          <td class="calculated">${this.headingLabel(leg.trueTrackDeg)}</td>
          <td class="calculated" title="${settings.automaticVariation ? `WMM2025 at leg midpoint: ${rawVariationDegEast.toFixed(2)}°, rounded for OFP` : 'Manual variation override'}">${variationLabel}</td>
          <td class="calculated">${this.headingLabel(magneticTrack)}</td>
          <td class="calculated" title="${windTitle}">${this.headingLabel(legPlan.windFromDeg)}/${Math.round(legPlan.windSpeedKt)}</td>
          <td class="calculated" title="Exact WCA for displayed ${legPlan.displayPhase} TAS: ${legPlan.wcaDeg.toFixed(2)}°">${this.signedDegrees(legPlan.wcaDeg)}</td>
          <td class="calculated" title="Exact accumulated distance: ${accumulatedDistanceNm.toFixed(2)} NM">${this.distanceLabel(accumulatedDistanceNm)}</td>
          <td class="calculated" title="Accumulated route time including modeled phase time">${this.formatMinutes(accumulatedTimeMinutes)}</td>
          ${legPlan.cruiseFuelFlowGph === null
            ? '<td class="pending" title="Enter Manual cruise FF when POH performance is disabled">—</td>'
            : `<td class="calculated" title="Cruise fuel flow. ${performanceTitle}">${legPlan.cruiseFuelFlowGph.toFixed(1)}</td>`}
          ${legPlan.legFuelGal === null
            ? `<td class="pending" title="${legPlan.phaseWarning ?? 'Fuel input incomplete'}">—</td>`
            : `<td class="calculated" title="${fuelTitle}">${legPlan.legFuelGal.toFixed(2)}</td>`}
          ${accumulatedFuelGal === null
            ? `<td class="pending" title="${accumulatedFuelTitle}">—</td>`
            : `<td class="calculated" title="${accumulatedFuelTitle}">${accumulatedFuelGal.toFixed(2)}</td>`}
          <td><strong>${leg.to.name}</strong></td>
          <td class="editable-cell ${belowMsa ? 'msa-warning-cell' : ''}">
            <input
              class="ofp-altitude-input ofp-msa-input"
              type="number"
              inputmode="numeric"
              min="0"
              max="30000"
              step="100"
              placeholder="ft"
              aria-label="Manual MSA ${leg.from.name} to ${leg.to.name}"
              title="Manual MSA. UTSA daylight VFR rule supplied for this project: highest terrain/obstacle within 1 NM of route plus 500 ft."
              data-msa-from="${leg.from.id}"
              data-msa-to="${leg.to.id}"
              value="${manualMsaFt ?? ''}"
            />
          </td>
          <td class="editable-cell ${belowMsa ? 'pl-warning-cell' : ''}">
            <input
              class="ofp-altitude-input"
              type="number"
              inputmode="numeric"
              min="0"
              max="30000"
              step="100"
              placeholder="ft"
              aria-label="Planned altitude ${leg.from.name} to ${leg.to.name}"
              title="${altitudeWarning}"
              data-alt-from="${leg.from.id}"
              data-alt-to="${leg.to.id}"
              value="${plannedAltitudeFt ?? ''}"
            />
          </td>
          <td class="calculated">${this.headingLabel(magneticHeading)}</td>
          <td class="calculated" title="${gsTitle}">${legPlan.groundSpeedKt.toFixed(0)}</td>
          <td class="calculated" title="Exact leg distance: ${leg.distanceNm.toFixed(2)} NM">${this.distanceLabel(leg.distanceNm)}</td>
          <td class="calculated" title="${timeTitle}">${this.formatMinutes(legPlan.totalTimeMin)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          ${estimatedRemainingGal === null
            ? `<td class="pending" title="${remainingTitle}">—</td>`
            : `<td class="calculated ${estimatedRemainingGal < 0 ? 'fuel-negative' : ''}" title="${remainingTitle}">${estimatedRemainingGal.toFixed(1)}</td>`}
          <td class="pending">—</td>
          <td class="pending">—</td>
        </tr>`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation calculation failed.';
      return {
        html: `<tr><td><strong>${leg.from.name}</strong></td><td colspan="24" class="calculation-error">${message}</td></tr>`,
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

  private phaseTimeTitle(leg: FuelLegPlan): string {
    const parts = [
      `cruise ${this.formatMinutes(leg.cruiseTimeMin)}`,
      leg.climbTimeMin > 0 ? `climb ${this.formatMinutes(leg.climbTimeMin)} at ${leg.climbTasKt?.toFixed(0) ?? '—'} KTAS` : '',
      leg.descentTimeMin > 0 ? `descent ${this.formatMinutes(leg.descentTimeMin)} at ${leg.descentTasKt?.toFixed(0) ?? '—'} KTAS` : '',
      leg.activityTimeMin > 0 ? `circuits/activity ${this.formatMinutes(leg.activityTimeMin)}` : '',
    ].filter(Boolean);
    return `Phase-aware leg time: ${parts.join(', ')}.`;
  }

  private phaseFuelTitle(leg: FuelLegPlan): string {
    const component = (name: string, value: number | null) => value === null ? `${name} needs FF` : `${name} ${value.toFixed(2)} gal`;
    return [
      component('cruise', leg.cruiseFuelGal),
      leg.climbTimeMin > 0 ? component('climb', leg.climbFuelGal) : '',
      leg.descentTimeMin > 0 ? component('descent', leg.descentFuelGal) : '',
      leg.activityTimeMin > 0 ? component('circuits', leg.circuitFuelGal) : '',
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
    const totalSeconds = Math.round(minutes * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return hours > 0
      ? `${hours}:${String(mins).padStart(2, '0')}`
      : `${mins}:${String(secs).padStart(2, '0')}`;
  }

  private formatActivityMinutes(minutes: number): string {
    return Number.isInteger(minutes) ? `${minutes} min` : `${minutes.toFixed(1)} min`;
  }
}