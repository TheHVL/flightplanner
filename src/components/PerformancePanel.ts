import type { FlightPlanStore, PerformanceSettings } from '../flightplan/FlightPlanStore';
import { calculateCruisePerformance } from '../performance/cruisePerformance';

export class PerformancePanel {
  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('input', (event) => this.handleInput(event));
  }

  render(): void {
    const settings = this.store.getPerformanceSettings();
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
    `;
    this.refreshResult();
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

  private handleInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const booleanField = input.dataset.performanceBoolean as keyof PerformanceSettings | undefined;
    if (booleanField) {
      this.store.updatePerformanceSettings({ [booleanField]: input.checked });
      this.refreshResult();
      return;
    }

    const field = input.dataset.performanceField as keyof PerformanceSettings | undefined;
    if (!field) return;
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    this.store.updatePerformanceSettings({ [field]: value });
    this.refreshResult();
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
}
