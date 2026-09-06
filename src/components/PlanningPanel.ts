import type { FlightPlanStore, PlanningSettings } from '../flightplan/FlightPlanStore';

interface FieldDefinition {
  key: keyof PlanningSettings;
  label: string;
  suffix: string;
  min?: number;
  max?: number;
  step?: number;
}

const FIELDS: FieldDefinition[] = [
  { key: 'plannedAltitudeFt', label: 'Cruise altitude', suffix: 'ft', min: 0, max: 18000, step: 100 },
  { key: 'tasKt', label: 'Manual TAS', suffix: 'kt', min: 1, max: 250, step: 1 },
  { key: 'windFromDegTrue', label: 'Wind from', suffix: '°T', min: 0, max: 360, step: 1 },
  { key: 'windSpeedKt', label: 'Wind speed', suffix: 'kt', min: 0, max: 150, step: 1 },
  { key: 'variationDegEastPositive', label: 'Variation', suffix: '° E(+)/W(-)', min: -30, max: 30, step: 0.1 },
  { key: 'fuelFlowGph', label: 'Fuel flow', suffix: 'GPH', min: 0, max: 30, step: 0.1 },
];

export class PlanningPanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
  }

  render(): void {
    const settings = this.store.getSettings();
    this.element.innerHTML = `
      <div class="planning-title">
        <div>
          <p class="eyebrow">PHASE 2</p>
          <h2>Navigation inputs</h2>
        </div>
        <span class="manual-chip">MANUAL</span>
      </div>
      <div class="planning-grid">
        ${FIELDS.map((field) => `
          <label class="planning-field">
            <span>${field.label}</span>
            <div class="number-input">
              <input type="number" data-setting="${field.key}" value="${settings[field.key]}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" />
              <b>${field.suffix}</b>
            </div>
          </label>
        `).join('')}
      </div>
      <p class="planning-note">Wind, variation, TAS and fuel flow are manual planning assumptions in this phase. Automatic providers are added later.</p>
    `;
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.setting as keyof PlanningSettings | undefined;
    if (!key) return;

    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    this.store.updateSettings({ [key]: value });
  }
}
