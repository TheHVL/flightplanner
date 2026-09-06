import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';
import { solveWindTriangle, trueToMagnetic } from '../navigation/wind';

export class OFPTable {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {}

  render(): void {
    const legs = this.store.getLegs();
    const settings = this.store.getNavigationSettings();
    const totalDistance = totalRouteDistanceNm(legs);

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
            ${legs.length === 0 ? '<tr><td colspan="21" class="table-empty">Add at least two waypoints to calculate a leg.</td></tr>' : legs.map((leg) => this.legRow(leg, settings)).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-legend"><span><i class="dot calculated-dot"></i> Calculated</span><span><i class="dot pending-dot"></i> Added in later phases</span></div>
    `;
  }

  private legRow(
    leg: ReturnType<FlightPlanStore['getLegs']>[number],
    settings: ReturnType<FlightPlanStore['getNavigationSettings']>,
  ): string {
    try {
      const wind = solveWindTriangle({
        trueTrackDeg: leg.trueTrackDeg,
        tasKt: settings.tasKt,
        windFromDeg: settings.windFromDeg,
        windSpeedKt: settings.windSpeedKt,
      });
      const magneticTrack = trueToMagnetic(leg.trueTrackDeg, settings.variationDegEast);
      const magneticHeading = trueToMagnetic(wind.trueHeadingDeg, settings.variationDegEast);
      const timeMinutes = (leg.distanceNm / wind.groundSpeedKt) * 60;
      const variationLabel = `${Math.abs(settings.variationDegEast).toFixed(1)}°${settings.variationDegEast >= 0 ? 'E' : 'W'}`;

      return `
        <tr>
          <td><strong>${leg.from.name}</strong></td>
          <td><strong>${leg.to.name}</strong></td>
          <td class="calculated">${settings.tasKt.toFixed(0)}</td>
          <td class="calculated">${leg.trueTrackDeg.toFixed(1)}°</td>
          <td class="calculated">${variationLabel}</td>
          <td class="calculated">${magneticTrack.toFixed(1)}°</td>
          <td class="calculated">${String(Math.round(settings.windFromDeg)).padStart(3, '0')}/${settings.windSpeedKt.toFixed(0)}</td>
          <td class="calculated">${this.signed(wind.wcaDeg)}°</td>
          <td class="calculated">${leg.distanceNm.toFixed(1)}</td>
          <td class="calculated">${this.formatMinutes(timeMinutes)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
          <td class="calculated">${wind.trueHeadingDeg.toFixed(1)}°</td>
          <td class="calculated">${magneticHeading.toFixed(1)}°</td>
          <td class="calculated">${wind.groundSpeedKt.toFixed(0)}</td>
          <td class="pending">—</td>
          <td class="pending">—</td>
        </tr>`;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Navigation calculation failed.';
      return `<tr><td><strong>${leg.from.name}</strong></td><td><strong>${leg.to.name}</strong></td><td colspan="19" class="calculation-error">${message}</td></tr>`;
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
