import { setPanelMarkup } from '../utils/panelMarkup';
import { escapeHtml } from '../utils/html';
import type { FlightPlanStore, LegWeatherForecast } from '../flightplan/FlightPlanStore';
import { routeLegMidpoint } from '../navigation/magneticVariation';
import { solveWindTriangle } from '../navigation/wind';
import { calculateCruisePerformance } from '../performance/cruisePerformance';
import { fetchForecastSample } from '../weather/openMeteo';

export class WeatherPanel {
  private loading = false;
  private requestVersion = 0;
  private statusMessage = 'Set a UTC departure time, then fetch winds and temperature along the route.';

  constructor(
    private readonly element: HTMLElement,
    private readonly store: FlightPlanStore,
  ) {
    this.element.addEventListener('change', (event) => this.handleChange(event));
    this.element.addEventListener('click', (event) => void this.handleClick(event));
    this.store.subscribe(() => this.render());
  }

  render(): void {
    const settings = this.store.getWeatherSettings();
    const forecasts = this.store.getWeatherForecasts();
    const manualWinds = this.store.getManualLegWinds();
    const legs = this.store.getLegs();
    const hasPerLegWindSource = forecasts.length > 0 || manualWinds.length > 0;

    setPanelMarkup(this.element, `
      <div class="panel-heading">
        <div>
          <p class="eyebrow">FLIGHT CONDITIONS</p>
          <h2>Route weather</h2>
        </div>
      </div>
      <p class="hint">Fetch model winds and temperature for your route and planned levels. Check them against your official weather briefing.</p>
      <div class="weather-controls">
        <label class="weather-time-field">
          <span>Flight date &amp; time (UTC)</span>
          <input type="datetime-local" data-weather-time value="${escapeHtml(settings.departureTimeUtc)}" />
        </label>
        <button class="weather-fetch-button" type="button" data-weather-fetch ${this.loading || legs.length === 0 ? 'disabled' : ''}>
          ${this.loading ? 'Fetching…' : 'Fetch route forecast'}
        </button>
      </div>
      <p class="menu-note">Reusing a plan? Set the new flight date and fetch fresh winds. This time is for the forecast, not an actual departure entry.</p>
      <label class="nav-toggle weather-toggle">
        <input type="checkbox" data-weather-use ${settings.useForecastWinds ? 'checked' : ''} ${hasPerLegWindSource ? '' : 'disabled'} />
        <span>Use per-leg route winds in calculations</span>
      </label>
      <div class="weather-status" role="status" aria-live="polite">${escapeHtml(this.statusMessage)}</div>
      ${forecasts.length > 0 ? this.forecastList(forecasts) : ''}
      ${legs.length > 0 ? `<details class="menu-subsection" data-menu-section="manual-winds"><summary>Manual wind backups by leg</summary>${this.manualWindList()}</details>` : ''}
      <details class="menu-help" data-menu-section="weather-help"><summary>Wind priority &amp; forecast source</summary>      <div class="weather-priority-note">
        <strong>Wind priority:</strong> fetched forecast for the leg → manual leg backup → global default manual wind. Manual leg winds remain stored if a forecast is fetched later.
      </div>
<div class="nav-help weather-source"><strong>Forecast source:</strong> Open-Meteo pressure-level forecast. Altitude interpolation uses geopotential height; time is interpolated between hourly forecast steps. Manual leg wind direction is FROM true north.</div></details>
    `);
  }

  onPlanLoaded(): void {
    this.requestVersion += 1;
    this.loading = false;
    this.statusMessage = 'Plan loaded. Check the flight date above, then fetch fresh winds. Manual leg wind backups were kept.';
    this.render();
  }

  private forecastList(forecasts: LegWeatherForecast[]): string {
    const legs = this.store.getLegs();
    return `
      <div class="weather-section-heading">
        <strong>Fetched route forecast</strong>
        <span>When enabled, a fetched value has priority over the manual backup for the same leg.</span>
      </div>
      <div class="weather-list">${forecasts.map((forecast) => {
        const leg = legs.find((candidate) => candidate.from.id === forecast.fromId && candidate.to.id === forecast.toId);
        const name = leg ? `${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}` : 'Route leg';
        return `
          <div class="weather-row">
            <div>
              <strong>${escapeHtml(name)}</strong>
              <span>${Math.round(forecast.altitudeFt)} ft · ${this.formatUtc(forecast.validTimeUtc)}</span>
            </div>
            <div class="weather-values">
              <strong>${String(Math.round(forecast.windFromDeg) % 360).padStart(3, '0')}°/${Math.round(forecast.windSpeedKt)} kt</strong>
              <span>${forecast.temperatureC >= 0 ? '+' : ''}${forecast.temperatureC.toFixed(1)}°C</span>
            </div>
          </div>`;
      }).join('')}</div>`;
  }

  private manualWindList(): string {
    const legs = this.store.getLegs();
    const forecasts = this.store.getWeatherForecasts();
    const forecastKeys = new Set(forecasts.map((forecast) => `${forecast.fromId}->${forecast.toId}`));

    return `
      <div class="weather-section-heading weather-section-heading--manual">
        <strong>Manual wind backup by leg</strong>
        <span>Leave a leg blank to fall back to the default wind. Entering a backup does not override a fetched forecast while per-leg route winds are enabled.</span>
      </div>
      <div class="manual-wind-list">
        ${legs.map((leg) => {
          const manual = this.store.getManualLegWind(leg.from.id, leg.to.id);
          const hasForecast = forecastKeys.has(`${leg.from.id}->${leg.to.id}`);
          const status = hasForecast
            ? manual ? 'Forecast primary · manual backup saved' : 'Forecast primary · no manual backup'
            : manual ? 'Manual backup available' : 'Default wind fallback';
          return `
            <div class="manual-wind-row">
              <div class="manual-wind-leg">
                <strong>${escapeHtml(leg.from.name)} → ${escapeHtml(leg.to.name)}</strong>
                <span>${status}</span>
              </div>
              <label>
                <span>From °T</span>
                <input
                  type="number"
                  min="0"
                  max="359"
                  step="1"
                  placeholder="—"
                  data-manual-wind-from-id="${leg.from.id}"
                  data-manual-wind-to-id="${leg.to.id}"
                  data-manual-wind-field="direction"
                  value="${manual?.windFromDeg ?? ''}"
                  aria-label="Manual wind direction ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}"
                />
              </label>
              <label>
                <span>Speed kt</span>
                <input
                  type="number"
                  min="0"
                  max="150"
                  step="1"
                  placeholder="—"
                  data-manual-wind-from-id="${leg.from.id}"
                  data-manual-wind-to-id="${leg.to.id}"
                  data-manual-wind-field="speed"
                  value="${manual?.windSpeedKt ?? ''}"
                  aria-label="Manual wind speed ${escapeHtml(leg.from.name)} to ${escapeHtml(leg.to.name)}"
                />
              </label>
              <button
                class="manual-wind-clear"
                type="button"
                data-manual-wind-clear-from="${leg.from.id}"
                data-manual-wind-clear-to="${leg.to.id}"
                ${manual ? '' : 'disabled'}
              >Clear</button>
            </div>`;
        }).join('')}
      </div>`;
  }

  private handleChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.matches('[data-weather-time]')) {
      this.requestVersion += 1;
      this.loading = false;
      this.store.updateWeatherSettings({ departureTimeUtc: input.value });
      this.store.clearWeatherForecasts();
      this.statusMessage = 'Departure time changed. Fetch the route forecast again. Manual leg wind backups were kept.';
      this.render();
      return;
    }
    if (input.matches('[data-weather-use]')) {
      this.store.updateWeatherSettings({ useForecastWinds: input.checked });
      return;
    }

    const fromId = input.dataset.manualWindFromId;
    const toId = input.dataset.manualWindToId;
    const field = input.dataset.manualWindField;
    if (!fromId || !toId || !field) return;

    if (input.value.trim() === '') {
      this.store.setManualLegWind(fromId, toId, null);
      return;
    }

    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    const current = this.store.getManualLegWind(fromId, toId);
    const globalWind = this.store.getNavigationSettings();
    const next = {
      windFromDeg: current?.windFromDeg ?? globalWind.windFromDeg,
      windSpeedKt: current?.windSpeedKt ?? globalWind.windSpeedKt,
    };
    if (field === 'direction') next.windFromDeg = value;
    if (field === 'speed') next.windSpeedKt = value;
    this.store.setManualLegWind(fromId, toId, next);
  }

  private async handleClick(event: Event): Promise<void> {
    const target = event.target as HTMLElement;
    const clearButton = target.closest<HTMLButtonElement>('[data-manual-wind-clear-from]');
    if (clearButton) {
      const fromId = clearButton.dataset.manualWindClearFrom;
      const toId = clearButton.dataset.manualWindClearTo;
      if (fromId && toId) this.store.setManualLegWind(fromId, toId, null);
      return;
    }

    const button = target.closest<HTMLButtonElement>('[data-weather-fetch]');
    if (!button || this.loading) return;
    await this.fetchRouteForecast();
  }

  private async fetchRouteForecast(): Promise<void> {
    const legs = this.store.getLegs();
    if (legs.length === 0) {
      this.statusMessage = 'Add at least two waypoints before fetching route weather.';
      this.render();
      return;
    }

    const weatherSettings = this.store.getWeatherSettings();
    const departureTime = this.parseUtcInput(weatherSettings.departureTimeUtc);
    if (!departureTime) {
      this.statusMessage = 'Enter a valid UTC departure date and time.';
      this.render();
      return;
    }

    const performanceSettings = this.store.getPerformanceSettings();
    const navigationSettings = this.store.getNavigationSettings();
    let tasKt = navigationSettings.tasKt;
    if (performanceSettings.usePohPerformance) {
      try {
        tasKt = calculateCruisePerformance(performanceSettings).ktas;
      } catch {
        tasKt = navigationSettings.tasKt;
      }
    }

    const requestInputs = this.forecastInputs();
    this.loading = true;
    const requestVersion = ++this.requestVersion;
    this.statusMessage = `Fetching forecast for ${legs.length} leg${legs.length === 1 ? '' : 's'}…`;
    this.render();

    try {
      const forecasts: LegWeatherForecast[] = [];
      let legStartMs = departureTime.getTime();

      for (let index = 0; index < legs.length; index += 1) {
        const leg = legs[index];
        this.statusMessage = `Fetching leg ${index + 1} of ${legs.length}: ${leg.from.name} → ${leg.to.name}…`;
        this.render();

        const altitudeFt = this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id)
          ?? performanceSettings.pressureAltitudeFt;
        const stillAirHours = leg.distanceNm / Math.max(tasKt, 1);
        const estimatedMidpointTime = new Date(legStartMs + stillAirHours * 0.5 * 60 * 60 * 1000);
        const midpoint = routeLegMidpoint(leg);
        const sample = await fetchForecastSample(midpoint.lat, midpoint.lon, altitudeFt, estimatedMidpointTime);
        if (requestVersion !== this.requestVersion) return;
        if (requestInputs !== this.forecastInputs()) throw new Error('Route or forecast settings changed. Fetch fresh winds again.');
        const windSolution = solveWindTriangle({
          trueTrackDeg: leg.trueTrackDeg,
          tasKt,
          windFromDeg: sample.windFromDeg,
          windSpeedKt: sample.windSpeedKt,
        });
        const legHours = leg.distanceNm / windSolution.groundSpeedKt;

        forecasts.push({
          fromId: leg.from.id,
          toId: leg.to.id,
          altitudeFt,
          validTimeUtc: sample.validTimeUtc,
          windFromDeg: sample.windFromDeg,
          windSpeedKt: sample.windSpeedKt,
          temperatureC: sample.temperatureC,
          source: sample.source,
        });
        legStartMs += legHours * 60 * 60 * 1000;
      }

      this.store.setRouteWeatherForecasts(forecasts);
      this.statusMessage = `Fresh forecast loaded for ${forecasts.length} leg${forecasts.length === 1 ? '' : 's'}. ${this.store.getWeatherSettings().useForecastWinds ? 'Forecast winds are active in calculations.' : 'Enable “Use per-leg route winds” to apply them.'} Manual winds remain as backups.`;
    } catch (error) {
      if (requestVersion !== this.requestVersion) return;
      this.store.clearWeatherForecasts();
      const message = error instanceof Error ? error.message : 'Route weather fetch failed.';
      this.statusMessage = `${message} Manual leg wind backups were kept.`;
    } finally {
      if (requestVersion === this.requestVersion) {
        this.loading = false;
        this.render();
      }
    }
  }

  private forecastInputs(): string {
    return JSON.stringify({
      legs: this.store.getLegs(),
      levels: this.store.getLegs().map((leg) => this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id)),
      time: this.store.getWeatherSettings().departureTimeUtc,
      performance: this.store.getPerformanceSettings(),
      navigation: this.store.getNavigationSettings(),
    });
  }

  private parseUtcInput(value: string): Date | null {
    if (!value) return null;
    const date = new Date(`${value}:00Z`);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  private formatUtc(value: string): string {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? `${date.toISOString().slice(11, 16)}Z` : '—';
  }
}
