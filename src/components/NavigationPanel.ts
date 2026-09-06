import type { FlightPlanStore, NavigationSettings } from '../flightplan/FlightPlanStore';

export class NavigationPanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('input', (event) => this.handleInput(event));
  }

  render(): void {
    const settings = this.store.getNavigationSettings();
    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PHASE 2</p>
          <h2>Navigation inputs</h2>
        </div>
      </div>
      <p class="hint">Manual inputs for the first Phase 2 release. Magnetic variation is entered as east-positive and west-negative until the automatic variation model is added.</p>
      <div class="nav-input-grid">
        ${this.numberField('tasKt', 'Cruise TAS', settings.tasKt, 'kt', 1, 40, 250)}
        ${this.numberField('windFromDeg', 'Wind from', settings.windFromDeg, '°T', 1, 0, 359)}
        ${this.numberField('windSpeedKt', 'Wind speed', settings.windSpeedKt, 'kt', 1, 0, 150)}
        ${this.numberField('variationDegEast', 'Variation', settings.variationDegEast, '° E(+)/W(-)', 0.1, -30, 30)}
      </div>
      <div class="nav-help">
        <strong>Calculated per leg:</strong> MT, WCA, TH, MH, GS and time. Wind direction is meteorological direction FROM true north.
      </div>
    `;
  }

  private numberField(
    field: keyof NavigationSettings,
    label: string,
    value: number,
    unit: string,
    step: number,
    min: number,
    max: number,
  ): string {
    return `
      <label class="nav-field">
        <span>${label}</span>
        <div class="nav-input-wrap">
          <input type="number" data-nav-field="${field}" value="${value}" step="${step}" min="${min}" max="${max}" />
          <em>${unit}</em>
        </div>
      </label>
    `;
  }

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const field = input.dataset.navField as keyof NavigationSettings | undefined;
    if (!field) return;

    const value = Number(input.value);
    if (!Number.isFinite(value)) return;

    this.store.updateNavigationSettings({ [field]: value });
  }
}
