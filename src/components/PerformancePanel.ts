import { applySchoolPreset, SCHOOL_PRESET_DESCRIPTION } from '../performance/schoolPreset';
import { setPanelMarkup } from '../utils/panelMarkup';
import { escapeHtml } from '../utils/html';
import type { FlightPlanStore, PerformanceSettings } from '../flightplan/FlightPlanStore';
import { calculateCruisePerformance } from '../performance/cruisePerformance';
import { ceilFuelUsageGal } from '../presentation/planningRounding';
import {
  calculateFuelPlanForStore,
  FUEL_SETTINGS_CHANGED_EVENT,
  getFuelPlanningSettings,
  saveFuelPlanningSettings,
  type FuelPlanningSettings,
} from '../fuel/fuelPlanning';

export class PerformancePanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
    private readonly view: 'full' | 'settings' | 'fuel' = 'full',
  ) {
    this.element.addEventListener('click', event => {
      if (!(event.target as HTMLElement).closest('[data-school-preset]')) return;
      try { applySchoolPreset(this.store); this.render(); }
      catch { this.element.querySelector('[data-preset-status]')!.textContent = 'Could not save the preset in this browser. Your aircraft settings have been kept.'; }
    });
    this.element.addEventListener('input', (event) => this.handleInput(event));
    this.store.subscribe(() => this.refreshFuelResult());
    if (typeof window !== 'undefined') {
      window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.syncFuelSettings());
    }
  }

  render(): void {
    const settings = this.store.getPerformanceSettings();
    const fuelSettings = getFuelPlanningSettings();
    setPanelMarkup(this.element, `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">C182T</p>
          <h2>C182T cruise performance</h2>
        </div>
      </div>
      <p class="hint">Choose cruise power below. Each leg uses its planned level and forecast temperature when available.</p>
      <details class="menu-subsection"><summary>School C182T preset</summary><p class="menu-note">${SCHOOL_PRESET_DESCRIPTION}</p>
        <button type="button" class="ghost-button" data-school-preset>Apply school C182T preset</button><p class="hint" data-preset-status role="status">Applying replaces aircraft performance and phase fuel settings. Fuel onboard and flight-specific contingency stay as entered.</p></details>
      <h3 class="menu-group-title">Cruise power &amp; fallback conditions</h3>
      <label class="nav-toggle performance-toggle">
        <input type="checkbox" data-performance-boolean="usePohPerformance" ${settings.usePohPerformance ? 'checked' : ''} />
        <span>Use POH TAS and fuel flow in the navigation log</span>
      </label>
      <div class="nav-input-grid performance-grid">
        ${this.numberField('pressureAltitudeFt', 'Fallback altitude', settings.pressureAltitudeFt, 'ft', 100, 0, 14000)}
        ${this.numberField('oatC', 'Fallback OAT', settings.oatC, '°C', 1, -60, 50)}
        ${this.numberField('rpm', 'RPM', settings.rpm, 'RPM', 50, 2000, 2400)}
        ${this.numberField('manifoldPressureInHg', 'Manifold pressure', settings.manifoldPressureInHg, 'inHg', 0.1, 15, 27)}
      </div>
      <div id="performance-result" class="performance-result"></div>
      <details class="menu-help" data-menu-section="cruise-help"><summary>POH source &amp; limits</summary><div class="nav-help performance-source">
        <strong>POH cruise conditions:</strong> 3100 lb, recommended lean mixture, cowl flaps closed. Maximum cruise power is 80% MCP; values above 80% are retained only to support POH interpolation. At high altitude some RPM/MP combinations are not published, and the planner will reject them rather than extrapolate. Figure 5-9 covers sea level through 14,000 ft and 2000-2400 RPM where published.
      </div></details>

      <div class="fuel-planning-section">
        <div class="fuel-section-heading">
          <p class="eyebrow">FUEL · PHASE-AWARE</p>
          <h3>Trip fuel planning</h3>
        </div>
        <p class="hint fuel-hint">Enter fuel onboard and the flows required for your flight. POH modes supply cruise and climb fuel automatically.</p>
        <h3 class="menu-group-title">Fuel onboard &amp; ground allowance</h3>
        <div class="nav-input-grid fuel-grid">
          ${this.fuelNumberField('startupTaxiTakeoffGal', 'Start/taxi/takeoff', fuelSettings.startupTaxiTakeoffGal, 'gal', 0.1, 0, 20, false)}
          ${this.fuelNumberField('totalFuelOnboardGal', 'Fuel onboard', fuelSettings.totalFuelOnboardGal, 'gal', 0.1, 0, 100)}
        </div>
        <h3 class="menu-group-title">Reserve &amp; flight-specific contingency</h3>
        <div class="nav-input-grid fuel-grid">
          ${this.fuelNumberField('reserveGal', 'Reserve', fuelSettings.reserveGal ?? 12, 'gal', 0.1, 0, 100, false)}
          ${this.fuelNumberField('contingencyGal', 'Contingency', fuelSettings.contingencyGal ?? null, 'gal', 0.1, 0, 100)}
        </div><p class="menu-note">The school preset holds 12 US gal in reserve. Choose contingency for this flight; no automatic percentage is assumed. Alternate and extra fuel need separate review.</p>
        <h3 class="menu-group-title">Manual fuel flows</h3>
        <p class="menu-note">Cruise and climb flows apply in manual modes. Descent and pattern flows are needed when those phases are planned.</p>
        <div class="nav-input-grid fuel-grid">
          ${this.fuelNumberField('manualCruiseFuelFlowGph', 'Manual cruise FF', fuelSettings.manualCruiseFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('climbFuelFlowGph', 'Manual climb FF', fuelSettings.climbFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('descentFuelFlowGph', 'Descent FF', fuelSettings.descentFuelFlowGph, 'GPH', 0.1, 0, 40)}
          ${this.fuelNumberField('circuitFuelFlowGph', 'Pattern FF', fuelSettings.circuitFuelFlowGph, 'GPH', 0.1, 0, 40)}
        </div>
        <div id="fuel-result" class="fuel-result"></div>
        <details class="menu-help" data-menu-section="fuel-help"><summary>Fuel source &amp; assumptions</summary><div class="nav-help fuel-source">
          <strong>Source/assumptions:</strong> the UiT OFP v4.2 fuel-requirements box states that Trip Fuel includes 1.7 US gal for startup, taxi and takeoff, the original default allowance is 1.7 gal. The school preset uses your updated allowance of 2 US gal. Figure 5-8 supplies climb fuel when a POH climb profile is selected. Figure 5-9 supplies cruise fuel flow. Calculated fuel usage is displayed rounded up to the next whole US gallon, while internal calculations retain full precision. PL/elevation are currently used as pressure-altitude proxies until QNH conversion is added.
        </div></details>
      </div>
    `);
    if (this.view === 'settings') this.element.querySelector('.fuel-planning-section')?.remove();
    if (this.view === 'fuel') {
      const fuel = this.element.querySelector('.fuel-planning-section');
      if (fuel) this.element.replaceChildren(fuel);
      this.element.querySelector('h3')!.textContent = 'Trip fuel';
    }
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
      [fuelField]: (fuelField === 'startupTaxiTakeoffGal' || fuelField === 'reserveGal') && value === null
        ? current.startupTaxiTakeoffGal
        : value,
    } as FuelPlanningSettings;
    saveFuelPlanningSettings(next);
    this.refreshFuelResult();
  }

  private syncFuelSettings(): void {
    const settings = getFuelPlanningSettings();
    for (const input of this.element.querySelectorAll<HTMLInputElement>('[data-fuel-field]')) {
      if (document.activeElement !== input) input.value = String(settings[input.dataset.fuelField as keyof FuelPlanningSettings] ?? '');
    }
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
      resultElement.innerHTML = `<div class="performance-error">${escapeHtml(message)}</div>`;
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

      const usageMetric = (label: string, value: number | null) => `
        <div class="fuel-metric">
          <span>${label}</span>
          <strong>${value === null ? 'NEEDS INPUT' : `${ceilFuelUsageGal(value)} GAL`}</strong>
        </div>
      `;
      const remainingMetric = (label: string, value: number | null) => `
        <div class="fuel-metric">
          <span>${label}</span>
          <strong>${value === null ? 'NEEDS INPUT' : `${value.toFixed(1)} GAL`}</strong>
        </div>
      `;
      const landing = plan.totalFuelOnboardGal === null
        ? '<div class="fuel-metric"><span>Est. landing fuel</span><strong>ENTER ONBOARD</strong></div>'
        : remainingMetric('Est. landing fuel', plan.landingFuelGal);
      const warningHtml = plan.warnings.length > 0
        ? `<div class="fuel-warning">${escapeHtml(plan.warnings.slice(0, 4).join(' '))}</div>`
        : '';

      resultElement.innerHTML = `
        ${usageMetric('Cruise', plan.cruiseFuelGal)}
        ${usageMetric('Climb', plan.climbFuelGal)}
        ${usageMetric('Descent', plan.descentFuelGal)}
        ${usageMetric('Pattern', plan.circuitFuelGal)}
        ${usageMetric('Start/taxi/takeoff', plan.startupTaxiTakeoffGal)}
        <div class="fuel-metric fuel-metric--total"><span>Trip fuel</span><strong>${plan.tripFuelGal === null ? 'NEEDS INPUT' : `${ceilFuelUsageGal(plan.tripFuelGal)} GAL`}</strong></div>
        ${usageMetric('Reserve', plan.reserveGal ?? 12)}
        ${usageMetric('Trip + reserve', plan.tripPlusReserveGal)}
        ${usageMetric('Contingency', plan.contingencyGal ?? null)}
        ${plan.contingencyGal !== null && plan.contingencyGal !== undefined ? usageMetric('Trip + reserve + contingency', plan.tripReserveContingencyGal) : '<p class="menu-note">Enter contingency, including zero if appropriate for this flight, to complete this subtotal.</p>'}
        ${landing}
        ${warningHtml}
      `;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to calculate route fuel.';
      resultElement.innerHTML = `<div class="performance-error">${escapeHtml(message)}</div>`;
    }
  }
}
