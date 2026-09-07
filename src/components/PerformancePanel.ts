import type { FlightPlanStore, PerformanceSettings } from '../flightplan/FlightPlanStore';
import { calculateCruisePerformance } from '../performance/cruisePerformance';
import {
  calculateFuelPlanForStore,
  getFuelPlanningSettings,
  saveFuelPlanningSettings,
  type FuelPlanningSettings,
} from '../fuel/fuelPlanning';

export class PerformancePanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('input', (event) => this.handleInput(event));
  }

  render(): void {
    const settings = this.store.getPerformanceSettings();
    const fuelSettings = getFuelPlanningSettings();
    this.element.innerHTML = `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">PHASE 4 · COMPLETE</p>
          <h2>C182T cruise performance</h2>
        </div>
      </div>
      <p class="hint">Complete POH Figure 5-9 cruise table, sea level through 14,000 ft, with 2000-2400 RPM where published. Interpolation remains bounded by the actual table cells, with no extrapolation.</p>
      <label class="nav-toggle performance-toggle">
        <input type="checkbox" data-performance-boolean="usePohPerformance" ${settings.usePohPerformance ? 'checked' : ''} />
        <span>Use POH TAS and fuel flow in the navigation log</span>
      </label>
      <div class="nav-input-grid performance-grid">
        ${this.numberField('pressureAltitudeFt', 'Pressure altitude', settings.pressureAltitudeFt, 'ft', 100, 0, 14000)}
        ${this.numberField('oatC', 'OAT', settings.oatC, '°C', 1, -60, 50)}
        ${this.numberField('rpm', 'RPM', settings.rpm, 'RPM', 50, 2000, 2400)}
        ${this.numberField('manifoldPressureInHg', 'Manifold pressure', settings.manifoldPressureInHg, 'inHg', 0.1, 15, 27)}
      </div>
      <div id="performance-result" class="performance-result"></div>
      <div class="nav-help performance-source">
        <strong>POH conditions:</strong> 3100 lb, recommended lean mixture, cowl flaps closed. Maximum cruise power is 80% MCP; values above 80% are retained only to support POH interpolation. At high altitude some RPM/MP combinations are not published, and the planner will reject them rather than extrapolate.
      </div>

      <div class="fuel-planning-section">
        <div class="fuel-section-heading">
          <p class="eyebrow">FUEL · PHASE-AWARE</p>
          <h3>Trip fuel planning</h3>
        </div>
        <p class="hint fuel-hint">Cruise fuel now follows each leg's PL and available route-weather OAT. Climb, descent and circuit fuel flow stay manual until verified C182T source data is supplied for those phases.</p>
        <div class="nav-input-grid fuel-grid">
          ${this.fuelNumberField('startupTaxiTakeoffGal', 'Start/taxi/takeoff', fuelSettings.startupTaxiTakeoffGal, 'gal', 0.1, 0, 20, false)}
          ${this.fuelNumberField('manualCruiseFuelFlowGph', 'Manual cruise FF', fuelSettings.manualCruiseFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('climbFuelFlowGph', 'Climb FF', fuelSettings.climbFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('descentFuelFlowGph', 'Descent FF', fuelSettings.descentFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('circuitFuelFlowGph', 'Circuit FF', fuelSettings.circuitFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('totalFuelOnboardGal', 'Fuel onboard', fuelSettings.totalFuelOnboardGal, 'gal', 0.1, 0, 100)}
        </div>
        <div id="fuel-result" class="fuel-result"></div>
        <div class="nav-help fuel-source">
          <strong>Source/assumptions:</strong> the UiT OFP v4.2 fuel-requirements box states that Trip Fuel includes 1.7 US gal for startup, taxi and takeoff, so 1.7 gal is the default allowance here. Figure 5-9 supplies cruise fuel flow only. PL is currently used as a pressure-altitude proxy until QNH conversion is added.
        </div>
      </div>
    `;
    this.refreshResult();
    this.refreshFuelResult();
  }

  private numberField(
    field: keyof PerformanceSettings,
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
          <input type="number" data-performance-field="${field}" value="${value}" step="${step}" min="${min}" max="${max}" />
          <em>${unit}</em>
        </div>
      </label>
    `;
  }

  private fuelNumberField(
    field: keyof FuelPlanningSettings,
    label: string,
    value: number | null,
    unit: string,
    step: number,
    min: number,
    max: number,
    nullable = true,
  ): string {
    return `
      <label class="nav-field">
        <span>${label}</span>
        <div class="nav-input-wrap">
          <input
            type="number"
            data-fuel-field="${field}"
            value="${value ?? ''}"
            step="${step}"
            min="${min}"
            max="${max}"
            ${nullable ? 'placeholder="optional"' : ''}
          />
          <em>${unit}</em>
        </div>
      </label>
    `;
  }

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const booleanField = input.dataset.performanceBoolean as keyof PerformanceSettings | undefined;
    if (booleanField) {
      this.store.updatePerformanceSettings({ [booleanField]: input.checked });
      this.refreshResult();
      this.refreshFuelResult();
      return;
    }

    const performanceField = input.dataset.performanceField as keyof PerformanceSettings | undefined;
    if (performanceField) {
      const value = Number(input.value);
      if (!Number.isFinite(value)) return;
      this.store.updatePerformanceSettings({ [performanceField]: value });
      this.refreshResult();
      this.refreshFuelResult();
      return;
    }

    const fuelField = input.dataset.fuelField as keyof FuelPlanningSettings | undefined;
    if (!fuelField) return;
    const current = getFuelPlanningSettings();
    const value = input.value.trim() === '' ? null : Number(input.value);
    if (value !== null && !Number.isFinite(value)) return;
    const next = {
      ...current,
      [fuelField]: fuelField === 'startupTaxiTakeoffGal' && value === null
        ? current.startupTaxiTakeoffGal
        : value,
    } as FuelPlanningSettings;
    saveFuelPlanningSettings(next);
    this.refreshFuelResult();
  }

  private refreshResult(): void {
    const resultElement = this.element.querySelector<HTMLElement>('#performance-result');
    if (!resultElement) return;

    try {
      const settings = this.store.getPerformanceSettings();
      const result = calculateCruisePerformance(settings);
      const warning = result.percentMcp > 80
        ? '<div class="performance-warning">Above 80% MCP. POH states these values are for interpolation only.</div>'
        : '';
      resultElement.innerHTML = `
        <div class="performance-metric"><span>Power</span><strong>${result.percentMcp.toFixed(1)}%</strong></div>
        <div class="performance-metric"><span>KTAS</span><strong>${result.ktas.toFixed(1)}</strong></div>
        <div class="performance-metric"><span>Fuel flow</span><strong>${result.fuelFlowGph.toFixed(1)} GPH</strong></div>
        <div class="performance-metric"><span>ISA deviation</span><strong>${result.temperatureOffsetC >= 0 ? '+' : ''}${result.temperatureOffsetC.toFixed(1)}°C</strong></div>
        ${warning}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate POH cruise performance.';
      resultElement.innerHTML = `<div class="performance-error">${message}</div>`;
    }
  }

  private refreshFuelResult(): void {
    const resultElement = this.element.querySelector<HTMLElement>('#fuel-result');
    if (!resultElement) return;

    try {
      const plan = calculateFuelPlanForStore(this.store);
      if (plan.legs.length === 0) {
        resultElement.innerHTML = '<div class="fuel-empty">Add a route to calculate phase-aware trip fuel.</div>';
        return;
      }

      const metric = (label: string, value: number | null) => `
        <div class="fuel-metric">
          <span>${label}</span>
          <strong>${value === null ? 'NEEDS INPUT' : `${value.toFixed(2)} GAL`}</strong>
        </div>
      `;
      const landing = plan.totalFuelOnboardGal === null
        ? '<div class="fuel-metric"><span>Est. landing fuel</span><strong>ENTER ONBOARD</strong></div>'
        : metric('Est. landing fuel', plan.landingFuelGal);
      const warningHtml = plan.warnings.length > 0
        ? `<div class="fuel-warning">${plan.warnings.slice(0, 4).join(' ')}</div>`
        : '';

      resultElement.innerHTML = `
        ${metric('Cruise', plan.cruiseFuelGal)}
        ${metric('Climb', plan.climbFuelGal)}
        ${metric('Descent', plan.descentFuelGal)}
        ${metric('Circuits', plan.circuitFuelGal)}
        ${metric('Start/taxi/takeoff', plan.startupTaxiTakeoffGal)}
        <div class="fuel-metric fuel-metric--total"><span>Trip fuel</span><strong>${plan.tripFuelGal === null ? 'NEEDS INPUT' : `${plan.tripFuelGal.toFixed(2)} GAL`}</strong></div>
        ${landing}
        ${warningHtml}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate route fuel.';
      resultElement.innerHTML = `<div class="performance-error">${message}</div>`;
    }
  }
}
