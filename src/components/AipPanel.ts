import { setPanelMarkup } from '../utils/panelMarkup';
import { aipFreshness, loadAipAerodromeCatalog, type AipAerodromeCatalog, type AipRefreshStatus, type AipAerodrome } from '../aip/aerodromes';
import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { escapeHtml as e } from '../utils/html';

export class AipPanel {
  private catalog: AipAerodromeCatalog | null = null;
  private refresh: AipRefreshStatus | null = null;
  private selectedIcao = '';
  private selectedPoints: string[] = [];
  private expandedAirports = new Set<string>();
  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore, private readonly onCatalogLoaded?: (catalog: AipAerodromeCatalog) => void, private readonly onCatalogError?: () => void) {
    this.element.innerHTML = `<h2>Airports &amp; reporting points</h2><div data-aip-status role="status">Loading Avinor catalog…</div>
      <button type="button" data-aip-reload>Check deployed data</button>
      <label>Search airports or reporting points<input type="search" data-aip-search placeholder="ENDU, Tromsø, point name…" /></label>
      <p data-aip-plan-status class="aip-status"></p><div data-aip-details></div><div data-aip-results></div>`;
    this.element.querySelector('[data-aip-search]')!.addEventListener('input', () => this.results());
    this.element.addEventListener('click', event => this.click(event));
    this.store.subscribe(() => this.planStatus());
    void this.load();
  }
  private async load(): Promise<void> {
    try {
      this.catalog = await loadAipAerodromeCatalog(true);
      this.store.setAipAerodromeCatalog(this.catalog);
      this.onCatalogLoaded?.(this.catalog);
      try {
        const response = await fetch(new URL('aip-status.json', document.baseURI), { cache: 'no-store' });
        if (!response.ok) throw new Error('Refresh status unavailable');
        this.refresh = await response.json();
      } catch { this.refresh = null; }
      const freshness = aipFreshness(this.catalog, this.refresh);
      const status = this.element.querySelector<HTMLElement>('[data-aip-status]')!;
      status.className = freshness.warning ? 'aip-status aip-status--warning' : 'aip-status';
      status.textContent = `${freshness.message} ${this.catalog.aerodromes.length} aerodromes · ${this.catalog.reportingPoints?.length ?? 0} reporting points. Daily publication checks. NOTAM and AIP supplements must be checked separately.`;
      this.results();
      this.details();
      this.planStatus();
    } catch (error) {
      this.onCatalogError?.();
      this.element.querySelector('[data-aip-status]')!.textContent = error instanceof Error ? error.message : 'Could not load AIP data.';
    }
  }
  private planStatus(): void {
    if (!this.catalog) return;
    const old = this.store.getWaypoints().filter(point => point.aipEffectiveDate && point.aipEffectiveDate !== this.catalog!.effectiveDate);
    const status = this.element.querySelector<HTMLElement>('[data-aip-plan-status]')!;
    status.className = old.length ? 'aip-status aip-status--warning' : 'aip-status';
    status.textContent = old.length ? `${old.length} route points were imported from an older AIP edition. Their saved coordinates have been retained. Compare them with the current publication before flying.` : '';
  }
  private results(): void {
    if (!this.catalog) return;
    const query = this.element.querySelector<HTMLInputElement>('[data-aip-search]')!.value.trim().toLocaleUpperCase();
    const tokens = query.split(/\s+/);
    const matches = (text: string) => tokens.every(token => text.toLocaleUpperCase().includes(token));
    const groups = [...this.catalog.aerodromes].sort((a, b) => a.icao.localeCompare(b.icao)).map(ad => {
      const airportMatches = matches(`${ad.icao} ${ad.name}`);
      const points = (this.catalog!.reportingPoints ?? []).filter(point => point.aerodromeIcao === ad.icao &&
        (airportMatches || matches(`${point.name} ${ad.icao} ${ad.name}`)))
        .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
      return { ad, points, airportMatches };
    }).filter(group => group.airportMatches || group.points.length);
    this.element.querySelector('[data-aip-results]')!.innerHTML = `<div class="aip-results">${groups.map(({ ad, points }) => `
      <details class="aip-airport-group" data-aip-group="${e(ad.icao)}" ${query || this.expandedAirports.has(ad.icao) ? 'open' : ''}>
        <summary><strong>${e(ad.icao)}</strong><span>${e(ad.name)}<small>${points.length} reporting point${points.length === 1 ? '' : 's'}</small></span></summary>
        <div class="aip-airport-content">
          <div class="aip-airport-actions"><button type="button" data-aip-ad="${e(ad.icao)}" aria-label="${e(ad.icao)} airport details">Airport details</button><button type="button" data-aip-add-ad="${e(ad.icao)}" ${ad.lat === null || ad.lon === null ? 'disabled' : ''}>Add airport</button></div>
          ${points.map(point => `<article class="aip-point-row"><span><strong>${e(point.name)}</strong>${point.remarks ? `<small>${e(point.remarks)}</small>` : ''}</span><button type="button" data-aip-add-point="${e(point.id)}" aria-label="Add ${e(point.name)} (${e(ad.icao)}) to route">Add</button></article>`).join('') || '<p class="aip-empty-points">No reporting points imported. Check the published chart.</p>'}
        </div>
      </details>`).join('') || '<p class="aip-empty-points">No airports or reporting points match your search.</p>'}</div>
      <small>${groups.length} airport${groups.length === 1 ? '' : 's'} · ${groups.reduce((sum, group) => sum + group.points.length, 0)} reporting points. Expand an airport to browse its points. Add appends to your current route.</small>`;
  }
  private details(): void {
    const ad = this.catalog?.aerodromes.find(ad => ad.icao === this.selectedIcao);
    if (!ad || !this.catalog) return;
    const points = (this.catalog.reportingPoints ?? []).filter(point => point.aerodromeIcao === ad.icao);
    setPanelMarkup(this.element.querySelector<HTMLElement>('[data-aip-details]')!, `<article class="aip-details">
      <button type="button" data-aip-close-details>Close airport details</button>
      <h3>${e(ad.icao)} · ${e(ad.name)}</h3>
      <p>${ad.elevationFt} ft AMSL · ARP ${ad.lat?.toFixed(5) ?? 'unavailable'} / ${ad.lon?.toFixed(5) ?? 'unavailable'}</p>
      <p>Transition altitude: ${ad.transitionAltitudeFt ?? 'not imported'}${ad.transitionAltitudeFt ? ' ft' : ''}</p>
      <a href="${e(ad.sourceUrl)}" target="_blank" rel="noopener noreferrer">Official AD 2 publication</a>
      <details class="menu-subsection" data-menu-section="${e(ad.icao)}-runways"><summary>Runways &amp; declared distances</summary>
      ${(ad.runways ?? []).map(rwy => `<p><strong>RWY ${e(rwy.designator)}</strong> · ${rwy.trueBearingDeg ?? '?'}° true · ${rwy.lengthM ?? '?'} × ${rwy.widthM ?? '?'} m · ${e(rwy.surface)}<br>TORA ${rwy.toraM ?? '?'} · TODA ${rwy.todaM ?? '?'} · ASDA ${rwy.asdaM ?? '?'} · LDA ${rwy.ldaM ?? '?'} m${rwy.remarks ? `<br>${e(rwy.remarks)}` : ''}</p>`).join('') || '<p>Not imported. Open AD 2.12/2.13.</p>'}
      </details><details class="menu-subsection" data-menu-section="${e(ad.icao)}-frequencies" open><summary>ATS frequencies / channels</summary>
      ${(ad.frequencies ?? []).map(freq => `<p><strong>${e(freq.service)} ${e(freq.frequencyMHz)}</strong> · ${e(freq.callSign)} · ${e(freq.hours)}${freq.remarks && freq.remarks !== 'NIL' ? `<br>${e(freq.remarks)}` : ''}</p>`).join('') || '<p>Not imported. Open AD 2.18.</p>'}
      </details>
      ${this.notes('Local regulations (AD 2.20)', ad.localRegulations)}${this.notes('Noise / circuit notes (AD 2.21)', ad.circuitNotes)}${this.notes('Flight procedures (AD 2.22)', ad.flightProcedures)}
      <details class="menu-subsection" data-menu-section="${e(ad.icao)}-charts" open><summary>Published charts</summary>
      ${(ad.charts ?? []).map(chart => `<p><a href="${e(chart.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(chart.title)}</a></p>`).join('') || '<p>No VFR chart imported.</p>'}
      <p class="hint">Read the chart for direction, altitude, clearance and aircraft restrictions.</p>
      </details>
      ${points.length ? `<details class="menu-subsection" data-menu-section="${e(ad.icao)}-sequence"><summary>Build your own point sequence</summary><p class="hint">Select points in the order you want to fly after checking the chart. This is your own sequence.</p><div class="aip-point-buttons">${points.map(point => `<button type="button" title="${e(point.remarks ?? 'Published chart point')}" data-aip-choose-point="${e(point.id)}">${e(point.name)}</button>`).join('')}</div><p data-aip-sequence>${this.sequenceLabel()}</p><button type="button" data-aip-append-sequence>Append selected points</button><button type="button" data-aip-clear-sequence>Clear selection</button></details>` : '<p>No machine-readable reporting points imported for this aerodrome.</p>'}
      ${(this.catalog.coverageWarnings ?? []).filter(warning => warning.startsWith(ad.icao)).map(warning => `<p class="aip-status--warning">${e(warning)}</p>`).join('')}
    </article>`);
  }
  private notes(title: string, value?: string): string { return value ? `<details class="menu-subsection" data-menu-section="${e(this.selectedIcao)}-${e(title)}"><summary>${e(title)}</summary><p>${e(value)}</p></details>` : ''; }
  private sequenceLabel(): string { return this.selectedPoints.map(id => e(this.catalog?.reportingPoints?.find(point => point.id === id)?.name ?? id)).join(' → ') || 'No points selected.'; }
  private addAirport(ad: AipAerodrome): void {
    if (ad.lat === null || ad.lon === null) return;
    this.store.appendAipWaypoints([{ name: ad.icao, lat: ad.lat, lon: ad.lon, aipId: ad.icao, aipEffectiveDate: this.catalog!.effectiveDate, elevationFt: ad.elevationFt }]);
  }
  private appendPoints(ids: string[]): void {
    const points = ids.map(id => this.catalog?.reportingPoints?.find(point => point.id === id));
    if (points.some(point => !point) || points.length === 0) return;
    this.store.appendAipWaypoints(points.map(point => ({ name: point!.name, lat: point!.lat, lon: point!.lon, aipId: point!.id, aipEffectiveDate: this.catalog!.effectiveDate })));
  }
  private click(event: Event): void {
    const summary = (event.target as HTMLElement).closest('summary');
    const group = summary?.parentElement as HTMLDetailsElement | undefined;
    if (group?.dataset.aipGroup) {
      if (group.open) this.expandedAirports.delete(group.dataset.aipGroup);
      else this.expandedAirports.add(group.dataset.aipGroup);
    }
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-aip-reload')) { void this.load(); return; }
    if (button.hasAttribute('data-aip-close-details')) { this.selectedIcao = ''; this.selectedPoints = []; this.element.querySelector('[data-aip-details]')!.innerHTML = ''; return; }
    if (!this.catalog) return;
    if (button.dataset.aipAd) { this.selectedIcao = button.dataset.aipAd; this.selectedPoints = []; this.details(); this.element.querySelector('[data-aip-details]')!.scrollIntoView({ block: 'nearest' }); }
    if (button.dataset.aipAddAd) { const ad = this.catalog.aerodromes.find(ad => ad.icao === button.dataset.aipAddAd); if (ad) this.addAirport(ad); }
    if (button.dataset.aipAddPoint) this.appendPoints([button.dataset.aipAddPoint]);
    if (button.dataset.aipChoosePoint) { this.selectedPoints.push(button.dataset.aipChoosePoint); this.element.querySelector('[data-aip-sequence]')!.innerHTML = this.sequenceLabel(); }
    if (button.hasAttribute('data-aip-append-sequence')) { this.appendPoints(this.selectedPoints); this.selectedPoints = []; this.details(); }
    if (button.hasAttribute('data-aip-clear-sequence')) { this.selectedPoints = []; this.details(); }
  }
}
