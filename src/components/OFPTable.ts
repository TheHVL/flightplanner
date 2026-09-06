import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import { NavigationCalculator } from '../navigation/NavigationCalculator';

export class OFPTable {
  private readonly navigationCalculator = new NavigationCalculator();

  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {}

  render(): void {
    const rawLegs = this.store.getLegs();
    const settings = this.store.getSettings();
    const totalDistance = totalRouteDistanceNm(rawLegs);
    let navigationError: string | null = null;
    let legs = [] as ReturnType<NavigationCalculator['calculateLegs']>;

    try {
      legs = this.navigationCalculator.calculateLegs(rawLegs, settings);
    } catch (error) {
      navigationError = error instanceof Error ? error.message : 'Unable to solve wind triangle.';
    }

    const totalTimeMinutes = legs.at(-1)?.accumulatedTimeMinutes ?? 0;
    const totalFuelGal = legs.at(-1)?.accumulatedFuelGal ?? 0;

    this.element.innerHTML = `
      <div class="ofp-heading">
        <div>
          <p class="eyebrow">OPERATIONAL FLIGHT PLAN</p>
          <h2>Navigation log</h2>
        </div>
        <div class="summary-strip">
          <div><span>Distance</span><strong>${totalDistance.toFixed(1)} NM</strong></div>
          <div><span>Time</span><strong>${this.formatMinutes(totalTimeMinutes)}</strong></div>
          <div><span>Fuel</span><strong>${totalFuelGal.toFixed(1)} USG</strong></div>
        </div>
      </div>
      ${navigationError ? `<div class="nav-warning">${navigationError}</div>` : ''}
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>FROM</th><th>TO</th><th>TAS</th><th>TT</th><th>VAR</th><th>MT</th><th>WIND<br>DIR/VEL</th><th>WCA</th><th>DIST</th><th>TIME</th><th>FF</th><th>INT</th><th>ACC</th><th>ALT</th><th>MSA</th><th>PL</th><th>TH</th><th>MH</th><th>GS</th><th>ETO</th><th>FREQ</th>
            </tr>
          </thead>
          <tbody>
            ${rawLegs.length === 0 ? '<tr><td colspan="21" class="table-empty">Add at least two waypoints to calculate a leg.</td></tr>' : ''}
            ${navigationError && rawLegs.length > 0 ? `<tr><td colspan="21" class="table-empty">Correct the navigation inputs to calculate this route.</td></tr>` : ''}
            ${legs.map((leg) => `
              <tr>
                <td><strong>${leg.from.name}</strong></td>
                <td><strong>${leg.to.name}</strong></td>
                <td>${settings.tasKt.toFixed(0)}</td>
                <td>${leg.trueTrackDeg.toFixed(1)}°</td>
                <td>${this.formatVariation(settings.variationDegEastPositive)}</td>
                <td>${leg.magneticTrackDeg.toFixed(1)}°</td>
                <td>${this.padHeading(settings.windFromDegTrue)}/${settings.windSpeedKt.toFixed(0)}</td>
                <td>${this.formatSigned(leg.wcaDeg)}°</td>
                <td>${leg.distanceNm.toFixed(1)}</td>
                <td>${this.formatMinutes(leg.timeMinutes)}</td>
                <td>${settings.fuelFlowGph.toFixed(1)}</td>
                <td>${leg.legFuelGal.toFixed(2)}</td>
                <td>${leg.accumulatedFuelGal.toFixed(2)}</td>
                <td>${settings.plannedAltitudeFt.toFixed(0)}</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td>${leg.trueHeadingDeg.toFixed(1)}°</td>
                <td>${leg.magneticHeadingDeg.toFixed(1)}°</td>
                <td>${leg.groundspeedKt.toFixed(0)}</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-legend"><span><i class="dot calculated-dot"></i> Calculated now</span><span><i class="dot pending-dot"></i> Provider/data required in later phases</span></div>
    `;
  }

  private formatMinutes(value: number): string {
    const totalSeconds = Math.round(value * 60);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  private formatVariation(value: number): string {
    if (Math.abs(value) < 0.05) return '0.0°';
    return `${Math.abs(value).toFixed(1)}°${value > 0 ? 'E' : 'W'}`;
  }

  private formatSigned(value: number): string {
    return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`;
  }

  private padHeading(value: number): string {
    const normalized = ((Math.round(value) % 360) + 360) % 360;
    return String(normalized).padStart(3, '0');
  }
}
