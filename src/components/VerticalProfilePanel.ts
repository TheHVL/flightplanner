import type { FlightPlanStore, VerticalProfileSettings } from '../flightplan/FlightPlanStore';
import { calculateVerticalProfile } from '../navigation/verticalProfile';

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
    const firstLeg = legs[0];
    const lastLeg = legs[legs.length - 1];
    const initialAltitudeFt = firstLeg
      ? this.store.getPlannedAltitudeFt(firstLeg.from.id, firstLeg.to.id)
      : null;
    const finalAltitudeFt = lastLeg
      ? this.store.getPlannedAltitudeFt(lastLeg.from.id, lastLeg.to.id)
      : null;

    let resultHtml = this.emptyResult(legs.length, initialAltitudeFt, finalAltitudeFt);
    if (firstLeg && lastLeg && initialAltitudeFt !== null && finalAltitudeFt !== null) {
      try {
        const result = calculateVerticalProfile({
          legs,
          ...settings,
          initialPlannedAltitudeFt: initialAltitudeFt,
          finalPlannedAltitudeFt: finalAltitudeFt,
        });
        resultHtml = `
          <div class="vertical-summary ${result.profilesOverlap ? 'vertical-summary--warning' : ''}">
            <div class="vertical-summary-row">
              <span>TOC</span>
              <strong>${result.tocOnRoute ? `${this.halfNm(result.tocDistanceFromDepartureNm)} NM after departure` : 'Beyond route'}</strong>
              <small>${Math.round(result.climbTimeMin)} min climb · ${Math.round(result.climbAltitudeGainFt)} ft gain</small>
            </div>
            <div class="vertical-summary-row">
              <span>TOD</span>
              <strong>${result.todOnRoute ? `${this.halfNm(result.todDistanceToDestinationNm)} NM before destination` : 'Before route start'}</strong>
              <small>${Math.round(result.descentTimeMin)} min descent · ${Math.round(result.descentAltitudeLossFt)} ft loss</small>
            </div>
            <div class="vertical-summary-row">
              <span>LEVEL</span>
              <strong>${this.halfNm(result.levelDistanceNm)} NM</strong>
              <small>${initialAltitudeFt.toLocaleString()} ft initial PL · ${finalAltitudeFt.toLocaleString()} ft final PL</small>
            </div>
          </div>
          ${result.profilesOverlap ? `<div class="vertical-warning">Climb and descent profiles overlap by ${this.halfNm(result.overlapDistanceNm)} NM. At the selected rates and groundspeeds there is no level segment between TOC and TOD.</div>` : ''}
        `;
      } catch (error) {
        resultHtml = `<div class="vertical-warning">${error instanceof Error ? error.message : 'Vertical profile calculation failed.'}</div>`;
      }
    }

    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PHASE 6</p>
          <h2>Vertical profile</h2>
        </div>
      </div>
      <p class="hint">TOC/TOD uses altitude change ÷ selected vertical speed for time, then groundspeed × time for route distance. Planned levels come from the OFP PL column.</p>
      <div class="vertical-input-grid">
        ${this.numberField('Departure elevation', 'dep-elev', settings.departureElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField('Destination elevation', 'dest-elev', settings.destinationElevationFt, 'ft', 0, 20000, 10)}
        ${this.numberField('Climb rate', 'climb-rate', settings.climbRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Descent rate', 'descent-rate', settings.descentRateFpm, 'ft/min', 100, 5000, 50)}
        ${this.numberField('Climb groundspeed', 'climb-gs', settings.climbGroundSpeedKt, 'kt', 20, 300, 1)}
        ${this.numberField('Descent groundspeed', 'descent-gs', settings.descentGroundSpeedKt, 'kt', 20, 300, 1)}
      </div>
      ${resultHtml}
      <div class="nav-help vertical-help"><strong>Planning assumption:</strong> Phase 6 currently models the initial climb to the first leg PL and the final descent from the last leg PL. Intermediate PL changes remain visible in the OFP but are not yet treated as separate step climbs/descents.</div>
    `;
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const field = input.dataset.verticalField;
    if (!field) return;
    const value = Number(input.value);
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
        <span>${label}</span>
        <div class="vertical-input-wrap">
          <input type="number" data-vertical-field="${field}" value="${value}" min="${min}" max="${max}" step="${step}" />
          <em>${unit}</em>
        </div>
      </label>`;
  }

  private emptyResult(legCount: number, initialAltitudeFt: number | null, finalAltitudeFt: number | null): string {
    if (legCount === 0) return '<div class="vertical-empty">Add at least two waypoints to calculate TOC/TOD.</div>';
    if (initialAltitudeFt === null || finalAltitudeFt === null) {
      return '<div class="vertical-empty">Enter a planned altitude (PL) in the OFP for the first and last route leg.</div>';
    }
    return '';
  }

  private halfNm(value: number): string {
    return (Math.round(value * 2) / 2).toFixed(1);
  }
}
