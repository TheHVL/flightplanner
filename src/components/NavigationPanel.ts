import { setPanelMarkup } from '../utils/panelMarkup';
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
    setPanelMarkup(this.element, `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">FALLBACK SETTINGS</p>
          <h2>Navigation defaults</h2>
        </div>
      </div>
      <p class="hint">Manual TAS applies when POH performance is off. Default winds apply when no active leg wind is available.</p>
      <h3 class="menu-group-title">Manual flight defaults</h3>
      <div class="nav-input-grid">
        ${this.numberField('tasKt', 'Manual cruise TAS', settings.tasKt, 'kt', 1, 40, 250)}
        ${this.numberField('windFromDeg', 'Wind from', settings.windFromDeg, '°T', 1, 0, 359)}
        ${this.numberField('windSpeedKt', 'Wind speed', settings.windSpeedKt, 'kt', 1, 0, 150)}
        </div>
      <h3 class="menu-group-title">Magnetic variation</h3>
      <div class="nav-input-grid">
        ${this.numberField('variationDegEast', 'Manual variation', roundVariationDeg(settings.variationDegEast), '° E(+)/W(-)', 1, -30, 30, settings.automaticVariation)}
      </div>
      <label class="nav-toggle">
        <input type="checkbox" data-nav-boolean="automaticVariation" ${settings.automaticVariation ? 'checked' : ''} />
        <span>Automatic magnetic variation (WMM2025, leg midpoint)</span>
      </label>
      <details class="menu-help" data-menu-section="navigation-help"><summary>Calculation details</summary><div class="nav-help">
        <strong>Calculated per leg:</strong> VAR, MT, WCA, TH, MH, GS and time. Wind direction is meteorological direction FROM true north. Manual TAS is used only when POH performance mode is disabled. WMM2025 variation is calculated at each leg midpoint and rounded to a whole degree for the OFP.
      </div></details>
    `);
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
