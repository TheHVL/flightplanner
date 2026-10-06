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

export class RouteReviewPanel {
  private controller: AbortController | null = null;
  private terrain: TerrainReview | null = null;
  private airspace = new Map<number, AirspaceEncounter[]>();
  private catalog: RadioCatalog | null = null;
  private status = 'Check the plotted route against sampled terrain and imported terminal airspace.';
  private altitudeNote = '';
  private airspaceNote = '';
  private version = 0;
  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore, private readonly frequencies: FrequencyPlanner) {
    element.addEventListener('click', event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-route-review]');
      if (!button) return;
      if (this.controller) this.invalidate('Check cancelled.');
      else void this.check();
    });
    store.subscribe(() => this.invalidate());
    window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, () => this.invalidate());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.invalidate());
    frequencies.subscribe(() => this.render());
    this.render();
  }
  private invalidate(message = 'Plan changed. Run the check again for the current route and profile.'): void {
    const hadResults = !!this.terrain || !!this.controller || this.airspace.size > 0;
    this.version++; this.controller?.abort(); this.controller = null;
    this.terrain = null; this.catalog = null; this.airspace.clear(); this.altitudeNote = ''; this.airspaceNote = '';
    if (hadResults) this.status = message;
    this.render();
  }
  private altitudeModel(legs: RouteLeg[]): { at: (leg: RouteLeg, distance: number) => number | null; breaks: number[] } {
    const levels = legs.map(leg => this.store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
    const offsets = new Map<number, number>(); let total = 0;
    legs.forEach(leg => { offsets.set(leg.index, total); total += leg.distanceNm; });
    try {
      const profile = calculateRouteVerticalProfile({ legs, plannedAltitudesFt: levels,
        waypointConstraints: this.store.getVerticalWaypointConstraints().map(c => ({ waypointId: c.waypointId, mode: c.mode, elevationFt: c.elevationFt })),
        ...this.store.getVerticalProfileSettings(), climbPerformanceMode: getFuelPlanningSettings().climbPerformanceMode,
        climbOatC: this.store.getPerformanceSettings().oatC });
      if (profile.climbPerformanceIncomplete || calculateVerticalProfileConflicts(profile).length) throw new Error('Resolve the vertical profile before comparing altitude with terrain or airspace.');
      if (levels.some(level => level === null)) this.altitudeNote = 'Enter PL for every leg to compare the modeled altitude.';
      return { at: (leg, distance) => levels[leg.index] === null ? null : modeledAltitudeFtAtRouteDistance(legs, levels, profile.events, offsets.get(leg.index)! + distance),
        breaks: profile.events.flatMap(event => event.type === 'TOC' ? [event.routeDistanceNm - event.distanceNm, event.routeDistanceNm] : [event.routeDistanceNm, event.routeDistanceNm + event.distanceNm]) };
    } catch (error) {
      this.altitudeNote = error instanceof Error ? error.message : 'Vertical profile unavailable.';
      return { at: () => null, breaks: [] };
    }
  }
  private async check(): Promise<void> {
    const legs = this.store.getLegs(); if (!legs.length) return;
    const version = ++this.version, controller = new AbortController(); this.controller = controller;
    this.terrain = null; this.airspace.clear(); this.catalog = null;
    this.airspaceNote = ''; this.altitudeNote = ''; this.status = 'Checking current data…'; this.render();
    try {
      const model = this.altitudeModel(legs);
      const probes = buildTerrainProbes(legs, model.at);
      await this.frequencies.reload();
      if (version !== this.version) return;
      this.catalog = this.frequencies.getVerifiedCatalog();
      if (this.catalog) {
        let offset = 0;
        for (const leg of legs) {
          this.airspace.set(leg.index, reviewLegAirspace(leg, this.catalog, distance => model.at(leg, distance), model.breaks.map(value => value - offset)));
          offset += leg.distanceNm;
        }
      } else this.airspaceNote = this.frequencies.getStatus();
      this.terrain = await fetchTerrainReview(probes, controller.signal, (done, total) => {
        if (version !== this.version) return;
        this.status = `Fetching terrain: ${done}/${total} points…`; this.render();
      });
      const available = this.terrain.heights.filter(Boolean).length;
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
    setPanelMarkup(this.element, `
      <p class="hint">Optional review of the plotted route, including climb and descent. Your MSA entries stay as entered.</p>
      <button type="button" data-route-review ${!this.store.getLegs().length ? 'disabled' : ''}>${this.controller ? 'Cancel check' : 'Check terrain &amp; airspace'}</button>
      <p role="status" aria-live="polite">${e(this.status)}</p>
      ${this.altitudeNote ? `<p class="menu-note">${e(this.altitudeNote)}</p>` : ''}
      ${this.airspaceNote ? `<p class="menu-note">Airspace unavailable: ${e(this.airspaceNote)}</p>` : ''}
      ${this.terrain || this.airspace.size ? `<div class="route-review-list">${this.store.getLegs().map(leg => this.legMarkup(leg)).join('')}</div>` : ''}
      <details class="menu-help" data-menu-section="route-review-coverage"><summary>Sources &amp; coverage</summary>
        <p>Terrain: <a href="https://ws.geonorge.no/hoydedata/v1/" target="_blank" rel="noopener noreferrer">Kartverket height API</a>. Sample spacing up to 0.5 NM along and across a strip 1 NM either side. This is sampled terrain, not a complete terrain maximum or obstacle database. The 500 ft margin is a review reference, including at departure and arrival; it does not calculate MSA.</p>
        ${this.terrain ? `<p>Fetched ${e(this.terrain.fetchedAt)}. Datasets: ${e([...new Set(this.terrain.heights.flatMap(h => h ? [h.dataset] : []))].join(', ') || 'none')}. Dataset observation dates are not supplied by this API.</p>` : ''}
        <p>Airspace: imported AIP terminal volumes only. ATS radio sectors are excluded. Restricted/danger areas, temporary restrictions and NOTAM are not covered. FL and AGL boundaries require review; no QNH conversion is assumed. An empty list does not mean unrestricted airspace.</p>
        ${this.catalog ? `<p>AIP ${e(this.catalog.effectiveDate)} · checked ${e(this.catalog.checkedAt)}.</p>${this.catalog.coverageWarnings.map(w => `<p>${e(w)}</p>`).join('')}` : ''}
      </details>`);
  }
  private legMarkup(leg: RouteLeg): string {
    const summary = this.terrain ? summarizeTerrainLeg(this.terrain, leg.index) : null;
    const encounters = this.airspace.get(leg.index) ?? [];
    const integer = (value: number | null) => value === null ? 'unavailable' : `${Math.round(value)} ft`;
    return `<details class="menu-subsection" data-menu-section="route-review-${leg.index}"><summary>${e(leg.from.name)} → ${e(leg.to.name)}</summary>
      ${summary ? `<p>Highest sampled surface: <strong>${integer(summary.highestFt)}</strong><br>Smallest sampled altitude margin: <strong>${integer(summary.minimumMarginFt)}</strong></p>
        <p>${summary.lowMarginCount} samples below the 500 ft review margin · ${summary.missing}/${summary.count} heights missing${summary.unknownAltitudeCount ? ` · ${summary.unknownAltitudeCount} samples without modeled altitude` : ''}.</p>` : '<p>Terrain not fetched yet.</p>'}
      ${this.catalog ? `<p><strong>Imported terminal airspace</strong></p>${encounters.map(encounter => `<p>${e(encounter.area.name)}: ${e({ intersects: 'modeled altitude within published limits', below: 'below published limits', above: 'above published limits', review: 'vertical limits require review' }[encounter.relation])}<br>${encounter.startNm.toFixed(1)}–${encounter.endNm.toFixed(1)} NM along leg · ${e(encounter.volume.publishedLimits)}<br><a href="${e(encounter.area.sourceUrl)}" target="_blank" rel="noopener noreferrer">Published source</a></p>`).join('') || '<p>No imported terminal footprint on this leg. Coverage is incomplete.</p>'}` : ''}
    </details>`;
  }
}
