import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import { automaticVariationForLeg } from '../navigation/magneticVariation';
import { solveWindTriangle, trueToMagnetic } from '../navigation/wind';
import {
  calculateCruisePerformance,
  type CruisePerformanceResult,
} from '../performance/cruisePerformance';

export class OFPTable {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {}

  render(): void {
    const legs = this.store.getLegs();
    const settings = this.store.getNavigationSettings();
    const performanceSettings = this.store.getPerformanceSettings();
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

    let accumulatedFuelGal = 0;
    const rows = legs.map((leg) => {
      const row = this.legRow(
        leg,
        settings,
        cruisePerformance,
        performanceError,
        accumulatedFuelGal,
      );
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
          <strong>${totalDistance.toFixed(1)} NM</strong>
        </div>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>FROM</th><th>TO</th><th>TAS</th><th>TT</th><th>VAR</th><th>MT</th><th>WIND<br>DIR/VEL</th><th>WCA</th><th>DIST</th><th>TIME</th><th>FF</th><th>INT</th><th>ACC</th><th>ALT</th><th>MSA</th><th>PL</th><th>TH</th><th>MH</th><th>GS</th><th>ETO</th><th>FREQ</th>
            </tr>
          </thead>
          <tbody>
            ${legs.length === 0 ? '<tr><td colspan="21" class="table-empty">Add at least two waypoints to calculate a leg.</td></tr>' : rows.join('')}
          </tbody>
        </table>
      </div>
      <div class="table-legend"><span><i class="dot calculated-dot"></i> Calculated</span><span><i class="dot pending-dot"></i> Added in later phases</span></div>
    `;
  }

  private legRow(
    leg: ReturnType<FlightPlanStore['getLegs']>[number],
    settings: ReturnType<FlightPlanStore['getNavigationSettings']>,
    cruisePerformance: CruisePerformanceResult | null,
    performanceError: string | null,
    accumulatedFuelBeforeGal: number,
  ): { html: string; fuelGal: number } {
    try {
      if (performanceError) {
        throw new Error(`POH performance: ${performanceError}`);
      }

      const tasKt = cruisePerformance?.ktas ?? settings.tasKt;
      const fuelFlowGph = cruisePerformance?.fuelFlowGph ?? null;
      const variationDegEast = settings.automaticVariation
        ? automaticVariationForLeg(leg).variationDegEast
        : settings.variationDegEast;

      const wind = solveWindTriangle({
        trueTrackDeg: leg.trueTrackDeg,
        tasKt,
        windFromDeg: settings.windFromDeg,
        windSpeedKt: settings.windSpeedKt,
      });
      const magneticTrack = trueToMagnetic(leg.trueTrackDeg, variationDegEast);
      const magneticHeading = trueToMagnetic(wind.trueHeadingDeg, variationDegEast);
      const timeHours = leg.distanceNm / wind.groundSpeedKt;
      const timeMinutes = timeHours * 60;
      const legFuelGal = fuelFlowGph === null ? 0 : fuelFlowGph * timeHours;
      const accumulatedFuelGal = accumulatedFuelBeforeGal + legFuelGal;
      const variationLabel = `${Math.abs(variationDegEast).toFixed(1)}°${variationDegEast >= 0 ? 'E' : 'W'}`;

      return {
        fuelGal: legFuelGal,
        html: `
        <tr>
          <td><strong>${leg.from.name}</strong></td>
          <td><strong>${leg.to.name}</strong></td>
          <td class="calculated">${tasKt.toFixed(0)}</td>
          <td class="calculated">${leg.trueTrackDeg.toFixed(1)}°</td>
          <td class="calculated" title="${settings.automaticVariation ? 'WMM2025 at leg midpoint' : 'Manual variation override'}">${variationLabel}</td>
          <td class="calculated">${magneticTrack.toFixed(1)}°</td>
          <td class="calculated">${String(Math.round(settings.windFromDeg)).padStart(3, '0')}/${settings.windSpeedKt.toFixed(0)}</td>
          <td class="calculated">${this.signed(wind.wcaDeg)}°</td>
          <td class="calculated">${leg.distanceNm.toFixed(1)}</td>
          <td class="calculated">${this.formatMinutes(timeMinutes)}</td>
          ${fuelFlowGph === null
            ? '<td class="pending">—</td><td class="pending">—</td><td class="pending">—</td>'
            : `<td class="calculated">${fuelFlowGph.toFixed(1)}</td><td class="calculated">${legFuelGal.toFixed(2)}</td><td class="calculated">${accumulatedFuelGal.toFixed(2)}</td>`}
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="calculated">${wind.trueHeadingDeg.toFixed(1)}°</td>
          <td class="calculated">${magneticHeading.toFixed(1)}°</td>
          <td class="calculated">${wind.groundSpeedKt.toFixed(0)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
        </tr>`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation calculation failed.';
      return {
        fuelGal: 0,
        html: `<tr><td><strong>${leg.from.name}</strong></td><td><strong>${leg.to.name}</strong></td><td colspan="19" class="calculation-error">${message}</td></tr>`,
      };
    }
  }

  private signed(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
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
