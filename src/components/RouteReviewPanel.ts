import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import type { FrequencyPlanner } from '../frequencies/FrequencyPlanner';
import type { RadioCatalog } from '../frequencies/catalog';
import { ROUTE_SHAPE_CHANGED_EVENT } from '../flightplan/RouteShapeController';
import { FUEL_SETTINGS_CHANGED_EVENT, getFuelPlanningSettings } from '../fuel/fuelPlanning';
import { modeledAltitudeFtAtRouteDistance } from '../navigation/glideEnvelope';
import { calculateRouteVerticalProfile } from '../navigation/verticalProfile';
import { calculateVerticalProfileConflicts } from '../navigation/verticalConflicts';
import { reviewLegAirspace, type AirspaceEncounter } from '../routing/airspace';
import { buildTerrainProbes, fetchTerrainReview, summarizeTerrainLeg, type TerrainReview } from '../routing/terrain';
import type { RouteLeg } from '../types';
import { escapeHtml as e } from '../utils/html';
import { setPanelMarkup } from '../utils/panelMarkup';
import { LEG_SELECTED, OPEN_TERRAIN_CHECK, openLegEditor, type LegEditorRequest } from './legEditorEvents';
import { airspaceRouteIssues, profileRouteIssues, sortRouteIssues, terrainRouteIssues, type RouteIssue } from '../routing/issues';
import { hasRestrictionCoverage } from '../routing/restrictions';
import { routeIssueMarkup } from '../presentation/routeIssues';

interface RouteReviewOptions {
  onIssues?: (issues: RouteIssue[], legs: RouteLeg[]) => void;
  onFocusIssue?: (issue: RouteIssue, legs: RouteLeg[]) => void;
}

export class RouteReviewPanel {
  private controller: AbortController | null = null;
  private terrain: TerrainReview | null = null;
  private airspace = new Map<number, AirspaceEncounter[]>();
  private catalog: RadioCatalog | null = null;
  private scope = '';
  private includeAirspace = false;
  private showOnMap = false;
  private status = 'Choose a leg and check its sampled terrain when you need help reviewing MSA.';
  private altitudeNote = '';
  private airspaceNote = '';
  private version = 0;
  private profileIssues: RouteIssue[] = [];
  private issues: RouteIssue[] = [];
  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore, private readonly frequencies: FrequencyPlanner, private readonly options: RouteReviewOptions = {}) {
    element.addEventListener('click', event => {
      const issueButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-route-issue]');
      if (issueButton) { this.openIssue(issueButton.dataset.routeIssue!, issueButton.dataset.issueAction!); return; }
      if ((event.target as HTMLElement).closest('[data-route-review-clear]')) {
        this.showOnMap = false; this.invalidate('Check cleared. Choose a leg to check again.'); return;
      }
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-route-review]');
      if (!button) return;
      if (this.controller) this.invalidate('Check cancelled.');
      else void this.check();
    });
    element.addEventListener('change', event => {
      const control = event.target as HTMLInputElement | HTMLSelectElement;
      if (control.matches('[data-review-scope]')) this.selectScope(control.value);
      else if (control.matches('[data-review-airspace]')) {
        this.includeAirspace = (control as HTMLInputElement).checked;
        this.invalidate('Check options changed. Run the check again.');
      } else if (control.matches('[data-review-map]')) {
        this.showOnMap = (control as HTMLInputElement).checked; this.render();
      }
    });
    window.addEventListener(LEG_SELECTED, event => {
      if (!this.element.isConnected || this.scope === 'all') return;
      const detail = (event as CustomEvent<LegEditorRequest>).detail;
      this.selectScope(`${detail.fromId}->${detail.toId}`);
    });
    window.addEventListener(OPEN_TERRAIN_CHECK, event => {
      if (!this.element.isConnected) return;
      const detail = (event as CustomEvent<LegEditorRequest>).detail;
      const scope = `${detail.fromId}->${detail.toId}`;
      if (!this.store.getLegs().some(leg => this.legKey(leg) === scope)) return;
      this.selectScope(scope);
      this.reveal(); this.element.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
      if (!this.controller) void this.check();
    });
    store.subscribe(() => this.invalidate());
    window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, () => this.invalidate());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.invalidate());
    frequencies.subscribe(() => this.render());
    this.render();
  }
  private legKey(leg: RouteLeg): string { return `${leg.from.id}->${leg.to.id}`; }
  private scopedLegs(): RouteLeg[] {
    return this.store.getLegs().filter(leg => this.scope === 'all' || this.legKey(leg) === this.scope);
  }
  private selectScope(scope: string): void {
    if (scope === this.scope || (scope !== 'all' && !this.store.getLegs().some(leg => this.legKey(leg) === scope))) return;
    this.scope = scope; this.invalidate('Selection changed. Run the check for this selection.');
  }
  private invalidate(message = 'Plan changed. Run the check again for the current route and profile.'): void {
    const hadResults = !!this.terrain || !!this.controller || this.airspace.size > 0 || !!this.altitudeNote || !!this.airspaceNote;
    this.version++; this.controller?.abort(); this.controller = null;
    this.terrain = null; this.catalog = null; this.airspace.clear(); this.altitudeNote = ''; this.airspaceNote = '';
    this.profileIssues = [];
    if (hadResults) this.status = message;
    this.render();
  }
  private altitudeModel(legs: RouteLeg[], checkedLegs: RouteLeg[]): { at: (leg: RouteLeg, distance: number) => number | null; breaks: number[] } {
    const levels = legs.map(leg => this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
    const offsets = new Map<number, number>(); let total = 0;
    legs.forEach(leg => { offsets.set(leg.index, total); total += leg.distanceNm; });
    try {
      const profile = calculateRouteVerticalProfile({ legs, plannedAltitudesFt: levels,
        waypointConstraints: this.store.getVerticalWaypointConstraints().map(c => ({ waypointId: c.waypointId, mode: c.mode, elevationFt: c.elevationFt })),
        ...this.store.getVerticalProfileSettings(), climbPerformanceMode: getFuelPlanningSettings().climbPerformanceMode,
        climbOatC: this.store.getPerformanceSettings().oatC });
      this.profileIssues = profileRouteIssues(profile, legs).filter(issue => checkedLegs.some(leg => leg.index === issue.legIndex));
      if (profile.climbPerformanceIncomplete || calculateVerticalProfileConflicts(profile).length) throw new Error('Resolve the vertical profile before comparing altitude with terrain or airspace.');
      if (checkedLegs.some(leg => levels[leg.index] === null)) this.altitudeNote = 'Enter PL for the checked leg to compare its modeled altitude. Sampled terrain heights are still available.';
      return { at: (leg, distance) => levels[leg.index] === null ? null : modeledAltitudeFtAtRouteDistance(legs, levels, profile.events, offsets.get(leg.index)! + distance),
        breaks: profile.events.flatMap(event => event.type === 'TOC' ? [event.routeDistanceNm - event.distanceNm, event.routeDistanceNm] : [event.routeDistanceNm, event.routeDistanceNm + event.distanceNm]) };
    } catch (error) {
      this.altitudeNote = error instanceof Error ? error.message : 'Vertical profile unavailable.';
      return { at: () => null, breaks: [] };
    }
  }
  private async check(): Promise<void> {
    const legs = this.store.getLegs(), checkedLegs = this.scopedLegs(); if (!checkedLegs.length) return;
    const version = ++this.version, controller = new AbortController(); this.controller = controller;
    this.terrain = null; this.airspace.clear(); this.catalog = null;
    this.profileIssues = [];
    this.airspaceNote = ''; this.altitudeNote = ''; this.status = 'Checking selected terrain…'; this.render();
    try {
      const model = this.altitudeModel(legs, checkedLegs);
      const probes = buildTerrainProbes(checkedLegs, model.at);
      if (this.includeAirspace) {
        await this.frequencies.reload();
        if (version !== this.version) return;
        this.catalog = this.frequencies.getVerifiedCatalog();
        if (this.catalog) {
          let offset = 0;
          for (const leg of legs) {
            if (checkedLegs.some(checked => checked.index === leg.index)) this.airspace.set(leg.index, reviewLegAirspace(leg, this.catalog, distance => model.at(leg, distance), model.breaks.map(value => value - offset)));
            offset += leg.distanceNm;
          }
        } else this.airspaceNote = this.frequencies.getStatus();
      }
      const terrain = await fetchTerrainReview(probes, controller.signal, (done, total) => {
        if (version !== this.version) return;
        this.status = `Fetching terrain: ${done}/${total} points…`; this.render();
      });
      if (version !== this.version) return;
      this.terrain = terrain;
      const available = terrain.heights.filter(Boolean).length;
      this.status = `${available}/${probes.length} terrain points returned. ${available < probes.length ? 'Missing points require chart review.' : 'Peaks between samples and obstacles still require chart review.'}`;
    } catch (error) {
      if (version !== this.version) return;
      this.status = error instanceof Error ? error.message : 'Route check unavailable. Try again.';
    } finally {
      if (version === this.version) { this.controller = null; this.render(); }
    }
  }
  render(): void {
    // An open tab must not continue displaying stale airspace as checked.
    if (this.catalog && this.catalog !== this.frequencies.getVerifiedCatalog()) {
      this.catalog = null; this.airspace.clear(); this.airspaceNote = this.frequencies.getStatus();
    }
    const legs = this.store.getLegs();
    if (this.scope !== 'all' && !legs.some(leg => this.legKey(leg) === this.scope)) this.scope = legs[0] ? this.legKey(legs[0]) : '';
    const checkedLegs = this.scopedLegs();
    const airports = this.store.getWaypoints().filter(point => this.store.isAirportWaypoint(point.id));
    this.issues = sortRouteIssues([...this.profileIssues, ...(this.terrain ? terrainRouteIssues(this.terrain, checkedLegs, airports) : []),
      ...airspaceRouteIssues([...this.airspace.values()].flat())]);
    if (this.terrain && this.includeAirspace && !hasRestrictionCoverage(this.catalog)) this.issues.push({ id: 'restriction-coverage', severity: 'incomplete', category: 'coverage', blocksTransfer: true,
      title: 'Published restriction coverage unavailable', detail: 'This check has no verified ENR 5.1 restriction footprint coverage. Missing results do not establish unrestricted airspace.',
      action: 'Run the check again after the published-data refresh succeeds, and review the official AIP and current NOTAM.' });
    if (this.altitudeNote && !this.issues.some(issue => issue.category === 'profile')) this.issues.push({ id: 'profile-unavailable', severity: 'incomplete', category: 'profile', blocksTransfer: true,
      title: 'Altitude/profile needs attention', detail: this.altitudeNote, action: 'Review the checked leg’s PL and aircraft/climb/descent settings, then run the check again. Terrain heights remain available without a valid altitude comparison.', focus: 'profile' });
    this.issues = sortRouteIssues(this.issues);
    this.options.onIssues?.(this.showOnMap ? this.issues : [], legs);
    setPanelMarkup(this.element, `
      <p class="hint">Check a leg you are unsure about. Your MSA stays as entered; sampled terrain does not include obstacles or establish a complete MSA.</p>
      <label class="route-review-scope">Check scope<select data-review-scope aria-label="Terrain check scope" ${!legs.length ? 'disabled' : ''}>
        ${!legs.length ? '<option value="">Add at least two waypoints</option>' : legs.map(leg => `<option value="${e(this.legKey(leg))}" ${this.scope === this.legKey(leg) ? 'selected' : ''}>Leg ${leg.index + 1}: ${e(leg.from.name)} → ${e(leg.to.name)}</option>`).join('')}
        ${legs.length ? `<option value="all" ${this.scope === 'all' ? 'selected' : ''}>Whole route</option>` : ''}
      </select></label>
      <label class="nav-toggle"><input type="checkbox" data-review-airspace ${this.includeAirspace ? 'checked' : ''} /><span>Include airspace &amp; restrictions</span></label>
      <label class="nav-toggle"><input type="checkbox" data-review-map ${this.showOnMap ? 'checked' : ''} /><span>Show findings on map</span></label>
      <div class="route-review-actions"><button type="button" data-route-review ${!checkedLegs.length ? 'disabled' : ''}>${this.controller ? 'Cancel check' : this.scope === 'all' ? 'Check whole route' : 'Check selected leg'}</button>
        ${this.terrain || this.airspace.size || this.altitudeNote ? '<button type="button" class="ghost-button" data-route-review-clear>Clear check</button>' : ''}</div>
      <p role="status" aria-live="polite">${e(this.status)}</p>
      ${this.altitudeNote ? `<p class="menu-note">${e(this.altitudeNote)}</p>` : ''}
      ${this.airspaceNote ? `<p class="menu-note">Airspace unavailable: ${e(this.airspaceNote)}</p>` : ''}
      ${this.terrain || this.airspace.size ? `<div class="route-review-list">${checkedLegs.map(leg => this.legMarkup(leg)).join('')}</div>` : ''}
      ${this.issues.length ? `<details class="menu-subsection" data-menu-section="route-review-findings"><summary>Findings &amp; next actions (${this.issues.length})</summary><div class="route-issues">${this.issues.slice(0, 3).map(issue => routeIssueMarkup(issue, legs, 'manual')).join('')}${this.issues.length > 3 ? `<details class="menu-subsection" data-menu-section="route-issues-more"><summary>Show ${this.issues.length - 3} more notices</summary>${this.issues.slice(3).map(issue => routeIssueMarkup(issue, legs, 'manual')).join('')}</details>` : ''}</div></details>` : ''}
      <details class="menu-help" data-menu-section="route-review-coverage"><summary>Sources &amp; coverage</summary>
        <p>Terrain: <a href="https://ws.geonorge.no/hoydedata/v1/" target="_blank" rel="noopener noreferrer">Kartverket height API</a>. Sample spacing up to 0.5 NM along and across a strip 1 NM either side. This is sampled terrain, not a complete terrain maximum or obstacle database. The 500 ft margin is a review reference, including at departure and arrival; it does not calculate MSA.</p>
        ${this.terrain ? `<p>Fetched ${e(this.terrain.fetchedAt)}. Datasets: ${e([...new Set(this.terrain.heights.flatMap(h => h ? [h.dataset] : []))].join(', ') || 'none')}. Dataset observation dates are not supplied by this API.</p>` : ''}
        <p>Airspace: imported AIP terminal volumes and available ENR 5.1 restriction footprints. ATS radio sectors are excluded. Restriction activation, temporary restrictions and NOTAM are not covered. FL and AGL boundaries require review; no QNH conversion is assumed. An empty list does not mean unrestricted airspace.</p>
        ${hasRestrictionCoverage(this.catalog) ? `<p>${this.catalog!.restrictionCoverage!.publishedAreaCount} published restriction footprints imported. Activation is unknown. Unsupported geometry is labelled as a conservative review footprint.</p>` : ''}
        ${this.catalog ? `<p>AIP ${e(this.catalog.effectiveDate)} · checked ${e(this.catalog.checkedAt)}.</p>${this.catalog.coverageWarnings.map(w => `<p>${e(w)}</p>`).join('')}` : ''}
      </details>`);
  }
  private reveal(): void {
    let node: HTMLElement | null = this.element;
    while (node) { if (node instanceof HTMLDetailsElement) node.open = true; node = node.parentElement; }
  }
  private openIssue(id: string, action: string): void {
    const issue = this.issues.find(item => item.id === id); if (!issue) return;
    const legs = this.store.getLegs(), leg = legs.find(l => l.index === issue.legIndex);
    if (action === 'profile') {
      const panel = document.querySelector<HTMLElement>('#profile-settings-panel');
      let node = panel ?? null;
      while (node) { if (node instanceof HTMLDetailsElement) node.open = true; node = node.parentElement; }
      panel?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); panel?.querySelector<HTMLInputElement>('input, select')?.focus();
    } else if (action === 'edit' && leg) openLegEditor({ fromId: leg.from.id, toId: leg.to.id, focus: issue.focus === 'profile' ? 'pl' : issue.focus });
    else if (action === 'map') {
      this.showOnMap = true; this.render(); this.options.onFocusIssue?.(issue, legs);
    }
  }
  private legMarkup(leg: RouteLeg): string {
    const summary = this.terrain?.probes.some(probe => probe.legIndex === leg.index) ? summarizeTerrainLeg(this.terrain, leg.index) : null;
    const encounters = this.airspace.get(leg.index) ?? [];
    const integer = (value: number | null) => value === null ? 'unavailable' : `${Math.round(value)} ft`;
    return `<details class="menu-subsection" data-menu-section="route-review-${leg.index}" ${this.scope !== 'all' ? 'open' : ''}><summary>${e(leg.from.name)} → ${e(leg.to.name)}</summary>
      ${summary ? `<p>Highest sampled surface: <strong>${integer(summary.highestFt)}</strong><br>Smallest sampled altitude margin: <strong>${integer(summary.minimumMarginFt)}</strong></p>
        <p>${summary.lowMarginCount} samples below the 500 ft review margin · ${summary.missing}/${summary.count} heights missing${summary.unknownAltitudeCount ? ` · ${summary.unknownAltitudeCount} samples without modeled altitude` : ''}.</p>` : '<p>Terrain not fetched yet.</p>'}
      ${this.catalog ? `<p><strong>Imported terminal airspace</strong></p>${encounters.map(encounter => `<p>${e(encounter.area.name)}: ${e({ intersects: 'modeled altitude within published limits', below: 'below published limits', above: 'above published limits', review: 'vertical limits require review' }[encounter.relation])}<br>${encounter.startNm.toFixed(1)}–${encounter.endNm.toFixed(1)} NM along leg · ${e(encounter.volume.publishedLimits)}<br><a href="${e(encounter.area.sourceUrl)}" target="_blank" rel="noopener noreferrer">Published source</a></p>`).join('') || '<p>No imported terminal footprint on this leg. Coverage is incomplete.</p>'}` : ''}
    </details>`;
  }
}
