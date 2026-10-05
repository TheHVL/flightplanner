import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { escapeHtml as e } from '../utils/html';

/** Stable controls: store emissions update the preview, never replace a field being edited. */
export class SequentialLegPanel {
  private fromId = '';
  private toId = '';
  private lastLegKeys = '';
  private saving = false;

  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore) {
    this.element.innerHTML = `
      <h2>Prepare legs</h2>
      <p class="hint">Enter advances through PL, MSA, wind direction and speed, then to the next leg. Shift+Enter goes back. Tab follows the normal keyboard order. Blank altitude clears it; leave both wind fields blank to use the global wind.</p>
      <label>Leg<select data-leg-selector aria-label="Leg to prepare"></select></label>
      <p data-leg-name class="leg-selection-name"></p>
      <form class="leg-entry-form">
        <label>PL (ft)<input data-leg-field="pl" type="number" min="0" max="30000" step="1" placeholder="ft" /></label>
        <label>MSA (ft)<input data-leg-field="msa" type="number" min="0" max="30000" step="1" placeholder="ft" /></label>
        <label>Wind FROM (°T)<input data-leg-field="direction" type="number" min="0" max="360" step="1" placeholder="000" /></label>
        <label>Wind (kt)<input data-leg-field="speed" type="number" min="0" max="150" step="1" placeholder="kt" /></label>
        <div class="leg-entry-actions"><button type="button" data-leg-prev>Previous</button><button type="submit">Save &amp; next leg</button></div>
      </form>
      <label class="nav-toggle"><input type="checkbox" data-leg-use-winds /><span>Use per-leg winds (forecast first, manual backup second)</span></label>
      <p data-leg-status role="status" aria-live="polite"></p>`;
    this.element.querySelector('select')!.addEventListener('change', () => this.select(Number(this.selector.value)));
    this.element.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      if (this.save()) this.advance(1);
    });
    this.element.querySelector('[data-leg-prev]')!.addEventListener('click', () => {
      if (this.save()) this.advance(-1);
    });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      event.preventDefault();
      const fields = this.fields;
      const index = fields.indexOf(event.target);
      if (index < 0 || !this.save(index !== 3)) return;
      const next = index + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= fields.length) {
        if (this.advance(event.shiftKey ? -1 : 1)) this.focusField(event.shiftKey ? fields.length - 1 : 0);
      } else this.focusField(next);
    });
    this.element.addEventListener('change', event => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.hasAttribute('data-leg-use-winds')) this.store.updateWeatherSettings({ useForecastWinds: event.target.checked });
      else this.save(true);
    });
    this.store.subscribe(() => this.sync());
    this.sync();
  }

  private get fields(): HTMLInputElement[] {
    return Array.from(this.element.querySelectorAll<HTMLInputElement>('[data-leg-field]'));
  }
  private get selector(): HTMLSelectElement { return this.element.querySelector('select')!; }
  private status(message: string): void { this.element.querySelector('[data-leg-status]')!.textContent = message; }
  private focusField(index: number): void { this.fields[index].focus(); this.fields[index].select(); }

  private sync(): void {
    const legs = this.store.getLegs();
    const keys = legs.map(leg => `${leg.from.id}->${leg.to.id}`).join('|');
    const previousIndex = Number(this.selector.value) || 0;
    this.selector.innerHTML = legs.map((leg, index) => `<option value="${index}">${index + 1}. ${e(leg.from.name)} → ${e(leg.to.name)}</option>`).join('');
    let index = legs.findIndex(leg => leg.from.id === this.fromId && leg.to.id === this.toId);
    if (index < 0) index = Math.min(previousIndex, legs.length - 1);
    this.selector.value = String(index);
    this.element.querySelector<HTMLInputElement>('[data-leg-use-winds]')!.checked = this.store.getWeatherSettings().useForecastWinds;
    for (const control of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select')) control.disabled = legs.length === 0;
    const editing = this.fields.includes(document.activeElement as HTMLInputElement);
    if (!this.saving && (keys !== this.lastLegKeys || !editing)) this.select(index);
    this.lastLegKeys = keys;
    if (legs.length === 0) this.status('Add at least two waypoints to prepare legs.');
  }

  private select(index: number): void {
    const leg = this.store.getLegs()[index];
    if (!leg) { this.fromId = ''; this.toId = ''; this.fields.forEach(field => field.value = ''); this.element.querySelector('[data-leg-name]')!.textContent = ''; return; }
    this.fromId = leg.from.id;
    this.toId = leg.to.id;
    this.selector.value = String(index);
    this.selector.title = `${leg.from.name} → ${leg.to.name}`;
    this.element.querySelector('[data-leg-name]')!.textContent = `${leg.from.name} → ${leg.to.name}`;
    const wind = this.store.getManualLegWind(this.fromId, this.toId);
    const values = [this.store.getPlannedAltitudeFt(this.fromId, this.toId), this.store.getManualMsaFt(this.fromId, this.toId), wind?.windFromDeg, wind?.windSpeedKt];
    this.fields.forEach((field, i) => field.value = values[i]?.toString() ?? '');
    this.status(this.windStatus());
  }

  private windStatus(): string {
    if (!this.store.getWeatherSettings().useForecastWinds) return 'Per-leg winds are disabled. Enable them in Route weather to use the saved manual winds.';
    const fetched = this.store.getWeatherForecasts().some(item => item.fromId === this.fromId && item.toId === this.toId);
    return fetched ? 'Fetched forecast is active; manual wind remains its backup.' : 'Manual leg wind is used when saved; otherwise the global wind is used.';
  }

  private save(allowIncompleteWind = false): boolean {
    if (!this.fromId || !this.toId) return false;
    const [pl, msa, direction, speed] = this.fields;
    for (const field of this.fields) if (!field.checkValidity()) { field.reportValidity(); return false; }
    const incompleteWind = (direction.value === '') !== (speed.value === '');
    if (incompleteWind && !allowIncompleteWind) {
      this.status('Enter both wind direction and speed, or leave both blank.');
      (direction.value === '' ? direction : speed).focus();
      return false;
    }
    // Capture before synchronous store emissions update other planner panels.
    const altitude = pl.value === '' ? null : Number(pl.value);
    const safeAltitude = msa.value === '' ? null : Number(msa.value);
    const wind = direction.value === '' ? null : { windFromDeg: Number(direction.value) % 360, windSpeedKt: Number(speed.value) };
    this.saving = true;
    try {
      this.store.setPlannedAltitudeFt(this.fromId, this.toId, altitude);
      this.store.setManualMsaFt(this.fromId, this.toId, safeAltitude);
      if (!incompleteWind) this.store.setManualLegWind(this.fromId, this.toId, wind);
    } finally { this.saving = false; }
    this.status(`Saved. ${altitude !== null && safeAltitude !== null && altitude < safeAltitude ? 'PL is below entered MSA. ' : ''}${this.windStatus()}`);
    return true;
  }

  private advance(delta: number): boolean {
    const next = Number(this.selector.value) + delta;
    if (next < 0 || next >= this.store.getLegs().length) { this.status(delta > 0 ? 'Last leg saved. Leg preparation complete.' : 'First leg saved.'); return false; }
    this.select(next);
    this.focusField(0);
    return true;
  }
}
