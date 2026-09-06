import type { FlightPlanStore, NavigationSettings } from '../flightplan/FlightPlanStore';
import { roundVariationDeg } from '../navigation/magneticVariation';

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
          <p class="eyebrow">PHASE 2 · COMPLETE</p>
          <h2>Navigation inputs</h2>
        </div>
      </div>
      <p class="hint">Wind triangle calculations use WMM2025 magnetic variation per leg, rounded to the nearest whole degree for the OFP. You can switch to a manual whole-degree variation override when needed.</p>
      <div class="nav-input-grid">
        ${this.numberField('tasKt', 'Manual cruise TAS', settings.tasKt, 'kt', 1, 40, 250)}
        ${this.numberField('windFromDeg', 'Wind from', settings.windFromDeg, '°T', 1, 0, 359)}
        ${this.numberField('windSpeedKt', 'Wind speed', settings.windSpeedKt, 'kt', 1, 0, 150)}
        ${this.numberField('variationDegEast', 'Manual variation', roundVariationDeg(settings.variationDegEast), '° E(+)/W(-)', 1, -30, 30, settings.automaticVariation)}
      </div>
      <label class="nav-toggle">
        <input type="checkbox" data-nav-boolean="automaticVariation" ${settings.automaticVariation ? 'checked' : ''} />
        <span>Automatic magnetic variation (WMM2025, leg midpoint)</span>
      </label>
      <div class="nav-help">
        <strong>Calculated per leg:</strong> VAR, MT, WCA, TH, MH, GS and time. Wind direction is meteorological direction FROM true north. Manual TAS is used only when POH performance mode is disabled.
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
    disabled = false,
  ): string {
    return `
      <label class="nav-field">
        <span>${label}</span>
        <div class="nav-input-wrap">
          <input type="number" data-nav-field="${field}" value="${value}" step="${step}" min="${min}" max="${max}" ${disabled ? 'disabled' : ''} />
          <em>${unit}</em>
        </div>
      </label>
    `;
  }

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const booleanField = input.dataset.navBoolean as keyof NavigationSettings | undefined;
    if (booleanField) {
      this.store.updateNavigationSettings({ [booleanField]: input.checked });
      const manualVariation = this.element.querySelector<HTMLInputElement>('[data-nav-field="variationDegEast"]');
      if (manualVariation) manualVariation.disabled = input.checked;
      return;
    }

    const field = input.dataset.navField as keyof NavigationSettings | undefined;
    if (!field) return;

    const value = Number(input.value);
    if (!Number.isFinite(value)) return;

    this.store.updateNavigationSettings({
      [field]: field === 'variationDegEast' ? roundVariationDeg(value) : value,
    });
  }
}
