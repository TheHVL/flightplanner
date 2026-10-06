import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { escapeHtml as e } from '../utils/html';
import { LEG_SELECTED, OPEN_LEG_EDITOR, type LegEditorRequest } from './legEditorEvents';

/** Stable controls: store emissions update the preview, never replace a field being edited. */
export class SequentialLegPanel {
  private fromId = '';
  private toId = '';
  private lastLegKeys = '';
  private saving = false;
  private hasDraft = false;
  private selectionListener?: (fromId: string, toId: string) => void;

  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore) {
    this.element.innerHTML = `
      <h2>Leg preparation</h2>
      <p class="hint">Select a leg here, on the map or in the OFP. Prepare its levels, wind and frequency in one place.</p>
      <details class="menu-help"><summary>Keyboard shortcuts &amp; empty fields</summary><p class="hint">Enter advances through PL, MSA, wind direction and speed, then to the next leg. Shift+Enter goes back. Tab follows the normal keyboard order. Blank altitude clears it; leave both wind fields blank to use the default wind.</p></details>
      <label>Leg<select data-leg-selector aria-label="Leg to prepare"></select></label>
      <p data-leg-name class="leg-selection-name"></p>
      <p class="leg-field-guide">PL is the planned level; MSA is your assessed minimum safe altitude. Both are in feet. Wind direction is FROM true north.</p>
      <form class="leg-entry-form">
        <label>PL (ft)<input data-leg-field="pl" type="number" min="0" max="30000" step="1" placeholder="ft" /></label>
        <label>MSA (ft)<input data-leg-field="msa" type="number" min="0" max="30000" step="1" placeholder="ft" /></label>
        <label>Wind FROM (°T)<input data-leg-field="direction" type="number" min="0" max="360" step="1" placeholder="000" /></label>
        <label>Wind (kt)<input data-leg-field="speed" type="number" min="0" max="150" step="1" placeholder="kt" /></label>
        <div class="leg-entry-actions"><button type="button" data-leg-prev>Previous</button><button type="submit">Save &amp; next leg</button></div>
      </form>
      <label class="nav-toggle"><input type="checkbox" data-leg-use-winds /><span>Use per-leg winds (forecast first, manual backup second)</span></label>
      <p data-leg-status role="status" aria-live="polite"></p>
      <section data-leg-frequency></section>
      <details class="menu-subsection" data-leg-visit><summary data-leg-visit-title>Airport / pattern at waypoint</summary><section data-waypoint-visit></section></details>`;
    this.selector.addEventListener('change', () => {
      const index = Number(this.selector.value);
      if (this.save()) this.select(index);
      else this.selector.value = String(this.store.getLegs().findIndex(leg => leg.from.id === this.fromId && leg.to.id === this.toId));
    });
    window.addEventListener(OPEN_LEG_EDITOR, event => this.open((event as CustomEvent<LegEditorRequest>).detail));
    this.element.addEventListener('input', event => {
      if ((event.target as HTMLElement).hasAttribute('data-leg-field')) this.hasDraft = true;
    });
    this.element.querySelector('form')!.addEventListener('submit', event => {
      event.preventDefault();
      if (this.save()) this.advance(1);
    });
    this.element.querySelector('[data-leg-prev]')!.addEventListener('click', () => {
      if (this.save()) this.advance(-1);
    });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      const fields = this.fields;
      const index = fields.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      if (!this.save(index !== 3)) return;
      const next = index + (event.shiftKey ? -1 : 1);
      if (next < 0 || next >= fields.length) {
        if (this.advance(event.shiftKey ? -1 : 1)) this.focusField(event.shiftKey ? fields.length - 1 : 0);
      } else this.focusField(next);
    });
    this.element.addEventListener('change', event => {
      if (!(event.target instanceof HTMLInputElement)) return;
      if (event.target.hasAttribute('data-leg-use-winds')) this.store.updateWeatherSettings({ useForecastWinds: event.target.checked });
      else if (event.target.hasAttribute('data-leg-field')) this.save(true);
    });
    this.store.subscribe(() => this.sync());
    this.sync();
  }

  private get fields(): HTMLInputElement[] {
    return Array.from(this.element.querySelectorAll<HTMLInputElement>('[data-leg-field]'));
  }
  private get selector(): HTMLSelectElement { return this.element.querySelector('[data-leg-selector]')!; }
  onSelection(listener: (fromId: string, toId: string) => void): void {
    this.selectionListener = listener;
    if (this.fromId && this.toId) listener(this.fromId, this.toId);
  }
  getSelectedLeg(): { fromId: string; toId: string } { return { fromId: this.fromId, toId: this.toId }; }
  onPlanLoaded(): void {
    this.hasDraft = false;
    this.sync();
    const index = this.store.getLegs().findIndex(leg => leg.from.id === this.fromId && leg.to.id === this.toId);
    this.select(index);
  }

  private open(request: LegEditorRequest): void {
    if (!this.element.isConnected) return;
    const index = this.store.getLegs().findIndex(leg => leg.from.id === request.fromId && leg.to.id === request.toId);
    if (index < 0) return;
    const disclosure = this.element.closest<HTMLDetailsElement>('details.phase-disclosure');
    if (disclosure) disclosure.open = true;
    if (this.fromId && !this.save()) return;
    this.select(index);
    let target: HTMLElement | null;
    if (request.focus === 'waypoint') {
      this.element.querySelector<HTMLDetailsElement>('[data-leg-visit]')!.open = true;
      window.dispatchEvent(new CustomEvent('flightplanner-select-waypoint-visit', { detail: { waypointId: request.waypointId ?? request.toId } }));
      target = this.element.querySelector<HTMLElement>('[data-waypoint-visit] select, [data-waypoint-visit] input');
    } else if (request.focus === 'frequency') target = this.element.querySelector('[data-frequency-choice]');
    else target = this.fields[request.focus === 'msa' ? 1 : 0] ?? null;
    (target ?? this.element).scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    target?.focus({ preventScroll: true });
  }
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
    for (const control of this.element.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('[data-leg-field], form button, [data-leg-selector], [data-leg-use-winds]')) control.disabled = legs.length === 0;
    const editing = this.fields.includes(document.activeElement as HTMLInputElement);
    if (!this.saving && (keys !== this.lastLegKeys || (!editing && !this.hasDraft))) this.select(index);
    this.lastLegKeys = keys;
    if (legs.length === 0) this.status('Add at least two waypoints to prepare legs.');
  }

  private select(index: number): void {
    this.hasDraft = false;
    const leg = this.store.getLegs()[index];
    if (!leg) { this.fromId = ''; this.toId = ''; this.fields.forEach(field => field.value = ''); this.element.querySelector('[data-leg-name]')!.textContent = ''; return; }
    const changed = this.fromId !== leg.from.id || this.toId !== leg.to.id;
    this.fromId = leg.from.id;
    this.toId = leg.to.id;
    this.selector.value = String(index);
    this.selector.title = `${leg.from.name} → ${leg.to.name}`;
    this.element.querySelector('[data-leg-name]')!.textContent = `${leg.from.name} → ${leg.to.name}`;
    const wind = this.store.getManualLegWind(this.fromId, this.toId);
    const values = [this.store.getPlannedAltitudeFt(this.fromId, this.toId), this.store.getManualMsaFt(this.fromId, this.toId), wind?.windFromDeg, wind?.windSpeedKt];
    this.fields.forEach((field, i) => field.value = values[i]?.toString() ?? '');
    this.status(this.windStatus());
    this.element.querySelector('[data-leg-visit-title]')!.textContent = `Airport / pattern · ${leg.to.name}`;
    if (changed) {
      this.selectionListener?.(this.fromId, this.toId);
      window.dispatchEvent(new CustomEvent(LEG_SELECTED, { detail: this.getSelectedLeg() }));
      window.dispatchEvent(new CustomEvent('flightplanner-select-waypoint-visit', { detail: { waypointId: this.toId } }));
    }
  }

  private windStatus(): string {
    if (!this.store.getWeatherSettings().useForecastWinds) return 'Global wind is active. Enable per-leg winds above to use forecasts or these manual backups.';
    const fetched = this.store.getWeatherForecasts().some(item => item.fromId === this.fromId && item.toId === this.toId);
    return fetched ? 'Fetched forecast is active; manual wind remains its backup.' : 'Manual leg wind is used when saved; otherwise the global wind is used.';
  }

  private save(allowIncompleteWind = false): boolean {
    if (!this.fromId || !this.toId) return false;
    this.hasDraft = true;
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
    this.hasDraft = incompleteWind;
    this.status(`Saved. ${altitude !== null && safeAltitude !== null && altitude < safeAltitude ? 'PL is below entered MSA. ' : ''}${this.windStatus()}`);
    return true;
  }

  private advance(delta: number): boolean {
    const next = Number(this.selector.value) + delta;
    if (next < 0 || next >= this.store.getLegs().length) { this.status(delta > 0 ? 'Last leg saved. Continue with Weather & fuel.' : 'First leg saved.'); return false; }
    this.select(next);
    this.focusField(0);
    return true;
  }
}
