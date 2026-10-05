import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { FUEL_SETTINGS_CHANGED_EVENT } from '../fuel/fuelPlanning';
import { escapeHtml as e } from '../utils/html';
import { setPanelMarkup } from '../utils/panelMarkup';
import type { FrequencyPlanner, LegFrequencyPlan } from '../frequencies/FrequencyPlanner';
import type { ChannelSuggestion } from '../frequencies/routeFrequencies';
export class FrequencyPanel {
  private selectedKey = '';
  private message = '';
  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore, private readonly planner: FrequencyPlanner) {
    element.addEventListener('change', event => this.change(event));
    element.addEventListener('click', event => this.click(event));
    planner.subscribe(() => this.render()); store.subscribe(() => this.render());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.render());
    window.addEventListener('flightplanner-select-frequency-leg', event => {
      const { fromId, toId } = (event as CustomEvent<{ fromId: string; toId: string }>).detail;
      const key = `${fromId}->${toId}`;
      if (!this.planner.getPlans().some(plan => this.key(plan) === key)) return;
      this.selectedKey = key;
      this.render();
      const panel = this.element.closest<HTMLDetailsElement>('details');
      if (panel) panel.open = true;
      this.element.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      this.element.querySelector<HTMLSelectElement>('[data-frequency-choice]')?.focus({ preventScroll: true });
    });
    this.render();
  }
  render(): void {
    const plans = this.planner.getPlans();
    const selected = plans.find(p => this.key(p) === this.selectedKey) ?? plans[0];
    this.selectedKey = selected ? this.key(selected) : '';
    const data = this.planner.getCatalog();
    const candidates = selected?.segments.flatMap(s => [...s.primary, ...s.alternatives]) ?? [];
    const options = [...new Map(candidates.map(c => [c.channel, c])).values()];
    const airportCandidates = selected?.airports.flatMap(({airport}) => (airport.frequencies ?? []).filter(f => f.frequencyMHz !== '121.500').map(f => ({ channel: f.frequencyMHz, label: `${airport.icao} ${f.service} · ${f.frequencyMHz}` }))) ?? [];
    const airportOptions = [...new Map(airportCandidates.filter(c => !options.some(option => option.channel === c.channel)).map(c => [c.channel, c])).values()];
    const hasSelectedOption = options.some(c => c.channel === selected?.manual) || airportOptions.some(c => c.channel === selected?.manual);
    setPanelMarkup(this.element, `
      <div class="panel-heading"><div><p class="eyebrow">COMMUNICATIONS</p><h2>Route frequencies</h2></div></div>
      <p class="hint">Published suggestions follow the plotted route and modeled altitude. Confirm the active channel with ATS; handoff positions are estimates.</p>
      <p class="frequency-data-status" role="status">${e(this.planner.getStatus())}</p>
      <div class="frequency-toolbar"><button class="ghost-button" type="button" data-frequency-refresh ${this.planner.isLoading() ? 'disabled' : ''}>Check deployed ATS data</button>${data ? `<a href="${e(data.issueUrl)}" target="_blank" rel="noopener noreferrer">Official AIP · ${e(data.effectiveDate)}</a>` : ''}</div>
      ${plans.length ? `<label class="frequency-leg-label">Route leg<select data-frequency-leg aria-label="Frequency planning leg">${plans.map(p => `<option value="${e(this.key(p))}" ${p === selected ? 'selected' : ''}>${p.leg.index + 1}. ${e(p.leg.from.name)} → ${e(p.leg.to.name)}</option>`).join('')}</select></label>
      <label class="frequency-manual-label">OFP channel for this leg<select data-frequency-choice aria-label="OFP channel for selected leg"><option value="">No channel selected</option>${selected!.manual && !hasSelectedOption ? `<option value="${e(selected!.manual)}" selected>${e(selected!.manual)} · Saved selection</option>` : ''}<optgroup label="Along the route">${options.map(c => `<option value="${e(c.channel)}" ${c.channel === selected!.manual ? 'selected' : ''}>${e(c.channel)} · ${e(c.callSign)}</option>`).join('')}</optgroup><optgroup label="Departure / arrival">${airportOptions.map(c => `<option value="${e(c.channel)}" ${c.channel === selected!.manual ? 'selected' : ''}>${e(c.label)}</option>`).join('')}</optgroup></select></label>
      <p class="frequency-active">${selected!.manual ? `OFP selection: <strong>${e(selected!.manual)}</strong>. Confirm it for this flight.` : 'Choose a channel to show in the OFP. Published suggestions remain available below.'}</p>
      <button class="ghost-button frequency-reset" type="button" data-frequency-auto ${selected!.manual ? '' : 'disabled'}>Clear OFP selection</button>
      <details class="menu-subsection" data-menu-section="manual-frequency"><summary>Enter a custom channel</summary>
        <p class="menu-note">Enter a VHF channel with three decimal places. Existing saved entries with multiple channels remain supported.</p>
        <label class="frequency-manual-label">OFP channel<input data-frequency-manual type="text" maxlength="69" placeholder="e.g. 126.455" value="${e(selected!.manual ?? '')}" aria-label="Manual channels for selected leg" /></label>
      </details>
      <details class="menu-subsection" data-menu-section="suggested-channels"><summary>Suggested services along this leg</summary>
      ${selected!.note ? `<p class="frequency-note">${e(selected!.note)}</p>` : ''}
      <div class="frequency-segments">${selected!.segments.map(s => `<article class="frequency-segment"><strong>~${s.startNm.toFixed(1)}–${s.endNm.toFixed(1)} NM from ${e(selected!.leg.from.name)}</strong>
        ${s.primary.map(c => this.candidate(c)).join('') || '<p>Automatic channel requires review.</p>'}
        ${s.note ? `<p class="frequency-note">${e(s.note)}</p>` : ''}
        ${s.alternatives.length ? `<details class="frequency-alternatives" data-menu-section="alternatives-${e(this.selectedKey)}-${s.startNm.toFixed(2)}"><summary>Other published services / channels</summary>${s.alternatives.map(c => this.candidate(c)).join('')}</details>` : ''}</article>`).join('')}</div>
      </details>
      ${selected!.airports.length ? `<details class="menu-subsection" data-menu-section="airport-channels"><summary>Departure &amp; arrival radio references</summary>${selected!.airports.map(({airport, position}) => `<article class="frequency-airport"><strong>${position} · ${e(airport.icao)} ${e(airport.name)}</strong>${(airport.frequencies ?? []).filter(f => f.frequencyMHz !== '121.500').map(f => `<p><strong>${e(f.service)} ${e(f.frequencyMHz)}</strong> · ${e(f.callSign)}<small>${e(f.hours)}${f.remarks && f.remarks !== 'NIL' ? ` · ${e(f.remarks)}` : ''}</small></p>`).join('')}<a href="${e(airport.sourceUrl)}" target="_blank" rel="noopener noreferrer">AD 2 source</a></article>`).join('')}</details>` : ''}` : '<p class="menu-note">Add at least two waypoints to plan route frequencies.</p>'}
      <p class="frequency-message" role="status">${e(this.message)}</p>
      <details class="menu-help" data-menu-section="frequency-help"><summary>Selection rules &amp; data coverage</summary><p class="menu-note">Local CTR/TIZ services take priority, followed by TMA/TIA services and Polaris radio sectors. Below a TMA, the overlying ATS service is suggested for information. Multiple published channels remain visible for confirmation. Opening hours, sector combinations, radio reception and NOTAM changes are not known live.</p><p class="menu-note">Altitude matching uses entered PL and the existing modeled climb/descent. Flight-level limits use a pressure-altitude approximation; verify the reference near a boundary. Great-circle paths are evaluated in chords of at most 1 NM. Country-border curves use Kartverket data simplified within 20 metres; connections to published border coordinates may differ by up to 1 km. Review the chart near boundaries.</p>${data ? `<p class="menu-note">Boundary data: <a href="${e(data.boundarySource.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(data.boundarySource.source)}</a> · ${e(data.boundarySource.license)}.</p>` : ''}${data?.coverageWarnings.length ? `<p class="menu-note">${data.coverageWarnings.map(w => e(w)).join('<br>')}</p>` : ''}<p class="menu-note">Automatic suggestions are recalculated when a saved plan is loaded. Manual entries remain saved and must be reviewed for the new flight.</p></details>
    `);
    const choice = this.element.querySelector<HTMLSelectElement>('[data-frequency-choice]');
    if (choice) choice.value = selected?.manual ?? '';
  }
  private candidate(c: ChannelSuggestion): string {
    return `<div class="frequency-candidate"><strong>${e(c.channel)}</strong><span>${e(c.callSign)}<small>${e(c.area.name)} · ${c.role === 'overlying' ? 'Overlying ATS, below this area' : c.role === 'sector' ? 'Published radio sector' : 'Within published radio area'}</small></span><a href="${e(c.area.sourceUrl)}" target="_blank" rel="noopener noreferrer" title="Open the published source">AIP</a></div>${c.remarks && c.remarks !== 'NIL' ? `<p class="frequency-remarks">${e(c.remarks)}</p>` : ''}`;
  }
  private key(p: LegFrequencyPlan): string { return `${p.leg.from.id}->${p.leg.to.id}`; }
  private change(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.hasAttribute('data-frequency-leg')) { this.selectedKey = target.value; this.message = ''; this.render(); return; }
    if (!target.matches('[data-frequency-manual],[data-frequency-choice]')) return;
    const plan = this.planner.getPlans().find(p => this.key(p) === this.selectedKey); if (!plan) return;
    if (!this.store.setManualFrequency(plan.leg.from.id, plan.leg.to.id, target.value)) {
      this.message = 'Use VHF channels from 118.000 to 136.999, with three decimal places. Separate multiple channels with /.';
      this.element.querySelector('[role="status"].frequency-message')!.textContent = this.message; return;
    }
    this.message = target.value.trim() ? 'OFP channel saved for this leg. Confirm it for this flight.' : 'OFP selection cleared.'; this.render();
  }
  private click(event: Event): void {
    const target = event.target as HTMLElement;
    if (target.closest('[data-frequency-refresh]')) { void this.planner.reload(); return; }
    if (target.closest('[data-frequency-auto]')) {
      const plan = this.planner.getPlans().find(p => this.key(p) === this.selectedKey);
      if (plan) { this.store.setManualFrequency(plan.leg.from.id, plan.leg.to.id, null); this.message = 'OFP selection cleared.'; this.render(); }
    }
  }
}
