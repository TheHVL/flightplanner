import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import {
  automaticVariationForLeg,
  roundVariationDeg,
} from '../navigation/magneticVariation';
import { solveWindTriangle, trueToMagnetic } from '../navigation/wind';
import {
  calculateCruisePerformance,
  type CruisePerformanceResult,
} from '../performance/cruisePerformance';

interface LegRowResult {
  html: string;
  fuelGal: number;
  timeMinutes: number;
}

export class OFPTable {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
  }

  render(): void {
    const legs = this.store.getLegs();
    const settings = this.store.getNavigationSettings();
    const performanceSettings = this.store.getPerformanceSettings();
    const weatherSettings = this.store.getWeatherSettings();
    const totalDistance = totalRouteDistanceNm(legs);

    let cruisePerformance: CruisePerformanceResult | null = null;
    let performanceError: string | null = null;
    if (performanceSettings.usePohPerformance) {
      try {
        cruisePerformance = calculateCruisePerformance(performanceSettings);
      } catch (error) {
        performanceError = error instanceof Error ? error.message : 'POH cruise calculation failed.';
      }
    }

    let accumulatedDistanceNm = 0;
    let accumulatedTimeMinutes = 0;
    let accumulatedFuelGal = 0;
    const rows = legs.map((leg) => {
      const row = this.legRow(
        leg,
        settings,
        weatherSettings.useForecastWinds,
        cruisePerformance,
        performanceError,
        accumulatedDistanceNm,
        accumulatedTimeMinutes,
        accumulatedFuelGal,
      );
      accumulatedDistanceNm += leg.distanceNm;
      accumulatedTimeMinutes += row.timeMinutes;
      accumulatedFuelGal += row.fuelGal;
      return row.html;
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
              <th title="Accumulated route time from departure">TIME</th>
              <th title="Fuel flow in US gallons per hour">FF<br><span class="ofp-unit">GPH</span></th>
              <th title="Fuel used on this leg">INT<br><span class="ofp-unit">GAL</span></th>
              <th title="Accumulated cruise fuel used">ACC<br><span class="ofp-unit">GAL</span></th>
              <th>MSA</th><th title="Planned level for this leg">PL</th>
              <th>GS</th><th title="Distance for this leg">DIST</th><th title="Time for this leg">TIME</th>
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
        <span>Fuel INT = this leg, Fuel ACC = accumulated cruise fuel used</span>
      </div>
    `;
  }

  private legRow(
    leg: ReturnType<FlightPlanStore['getLegs']>[number],
    settings: ReturnType<FlightPlanStore['getNavigationSettings']>,
    useForecastWinds: boolean,
    cruisePerformance: CruisePerformanceResult | null,
    performanceError: string | null,
    accumulatedDistanceBeforeNm: number,
    accumulatedTimeBeforeMinutes: number,
    accumulatedFuelBeforeGal: number,
  ): LegRowResult {
    try {
      if (performanceError) {
        throw new Error(`POH performance: ${performanceError}`);
      }

      const tasKt = cruisePerformance?.ktas ?? settings.tasKt;
      const fuelFlowGph = cruisePerformance?.fuelFlowGph ?? null;
      const rawVariationDegEast = settings.automaticVariation
        ? automaticVariationForLeg(leg).variationDegEast
        : settings.variationDegEast;
      const variationDegEast = roundVariationDeg(rawVariationDegEast);
      const forecast = this.store.getLegWeatherForecast(leg.from.id, leg.to.id);
      const forecastActive = useForecastWinds && forecast !== null;
      const windFromDeg = forecastActive ? forecast.windFromDeg : settings.windFromDeg;
      const windSpeedKt = forecastActive ? forecast.windSpeedKt : settings.windSpeedKt;

      const wind = solveWindTriangle({
        trueTrackDeg: leg.trueTrackDeg,
        tasKt,
        windFromDeg,
        windSpeedKt,
      });
      const magneticTrack = trueToMagnetic(leg.trueTrackDeg, variationDegEast);
      const magneticHeading = trueToMagnetic(wind.trueHeadingDeg, variationDegEast);
      const timeHours = leg.distanceNm / wind.groundSpeedKt;
      const timeMinutes = timeHours * 60;
      const accumulatedDistanceNm = accumulatedDistanceBeforeNm + leg.distanceNm;
      const accumulatedTimeMinutes = accumulatedTimeBeforeMinutes + timeMinutes;
      const legFuelGal = fuelFlowGph === null ? 0 : fuelFlowGph * timeHours;
      const accumulatedFuelGal = accumulatedFuelBeforeGal + legFuelGal;
      const variationLabel = `${Math.abs(variationDegEast)}°${variationDegEast >= 0 ? 'E' : 'W'}`;
      const plannedAltitudeFt = this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id);
      const windTitle = forecastActive
        ? `${forecast.source}; ${Math.round(forecast.altitudeFt)} ft; ${new Date(forecast.validTimeUtc).toISOString().slice(11, 16)}Z; OAT ${forecast.temperatureC.toFixed(1)}°C`
        : 'Manual wind input';

      return {
        fuelGal: legFuelGal,
        timeMinutes,
        html: `
        <tr>
          <td><strong>${leg.from.name}</strong></td>
          <td class="calculated">${tasKt.toFixed(0)}</td>
          <td class="calculated">${this.headingLabel(leg.trueTrackDeg)}</td>
          <td class="calculated" title="${settings.automaticVariation ? `WMM2025 at leg midpoint: ${rawVariationDegEast.toFixed(2)}°, rounded for OFP` : 'Manual variation override'}">${variationLabel}</td>
          <td class="calculated">${this.headingLabel(magneticTrack)}</td>
          <td class="calculated" title="${windTitle}">${this.headingLabel(windFromDeg)}/${Math.round(windSpeedKt)}</td>
          <td class="calculated" title="Exact WCA: ${wind.wcaDeg.toFixed(2)}°">${this.signedDegrees(wind.wcaDeg)}</td>
          <td class="calculated" title="Exact accumulated distance: ${accumulatedDistanceNm.toFixed(2)} NM">${this.distanceLabel(accumulatedDistanceNm)}</td>
          <td class="calculated" title="Accumulated time from departure">${this.formatMinutes(accumulatedTimeMinutes)}</td>
          ${fuelFlowGph === null
            ? '<td class="pending">—</td><td class="pending">—</td><td class="pending">—</td>'
            : `<td class="calculated" title="Fuel flow, US gal/hour">${fuelFlowGph.toFixed(1)}</td><td class="calculated" title="Fuel used on this leg, US gal">${legFuelGal.toFixed(2)}</td><td class="calculated" title="Accumulated cruise fuel used, US gal">${accumulatedFuelGal.toFixed(2)}</td>`}
          <td><strong>${leg.to.name}</strong></td>
          <td class="pending">—</td>
          <td class="editable-cell">
            <input
              class="ofp-altitude-input"
              type="number"
              inputmode="numeric"
              min="0"
              max="30000"
              step="100"
              placeholder="ft"
              aria-label="Planned altitude ${leg.from.name} to ${leg.to.name}"
              title="Planned level for this leg in feet"
              data-alt-from="${leg.from.id}"
              data-alt-to="${leg.to.id}"
              value="${plannedAltitudeFt ?? ''}"
            />
          </td>
          <td class="calculated">${this.headingLabel(magneticHeading)}</td>
          <td class="calculated">${wind.groundSpeedKt.toFixed(0)}</td>
          <td class="calculated" title="Exact leg distance: ${leg.distanceNm.toFixed(2)} NM">${this.distanceLabel(leg.distanceNm)}</td>
          <td class="calculated" title="Time for this leg">${this.formatMinutes(timeMinutes)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
        </tr>`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation calculation failed.';
      return {
        fuelGal: 0,
        timeMinutes: 0,
        html: `<tr><td><strong>${leg.from.name}</strong></td><td colspan="24" class="calculation-error">${message}</td></tr>`,
      };
    }
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
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
}
