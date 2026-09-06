import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { totalRouteDistanceNm } from '../navigation/geodesy';

export class OFPTable {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {}

  render(): void {
    const legs = this.store.getLegs();
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
            ${legs.length === 0 ? '<tr><td colspan="21" class="table-empty">Add at least two waypoints to calculate a leg.</td></tr>' : legs.map((leg) => `
              <tr>
                <td><strong>${leg.from.name}</strong></td>
                <td><strong>${leg.to.name}</strong></td>
                <td class="pending">—</td>
                <td class="calculated">${leg.trueTrackDeg.toFixed(1)}°</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="calculated">${leg.distanceNm.toFixed(1)}</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
                <td class="pending">—</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="table-legend"><span><i class="dot calculated-dot"></i> Phase 1 calculated</span><span><i class="dot pending-dot"></i> Added in later phases</span></div>
    `;
  }
}
