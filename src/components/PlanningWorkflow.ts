import type { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { FUEL_SETTINGS_CHANGED_EVENT, getFuelPlanningSettings } from '../fuel/fuelPlanning';
import { totalRouteDistanceNm } from '../navigation/geodesy';

const step = (key: string, number: number, title: string, content: string, open = false) => `
  <details class="phase-disclosure workflow-step" data-panel-key="${key}" ${open ? 'open' : ''}>
    <summary><span class="workflow-number">${number}</span><div class="workflow-title"><strong>${title}</strong><small data-workflow-summary="${key}"></small></div></summary>
    ${content}
  </details>`;
export const planningSidebarMarkup = `
  <div class="sidebar-menu-heading"><strong>Flight preparation</strong><button type="button" id="collapse-planning-menus" class="ghost-button">Collapse all</button></div>
  <p class="workflow-intro">Start with your route, then work through the four steps. Saved plans and aircraft settings are below.</p>
  ${step('route', 1, 'Build route', `<section id="route-panel" class="route-panel panel"></section><details class="menu-subsection" data-menu-section="aip-browser"><summary>Add airports &amp; reporting points</summary><section id="aip-panel" class="panel"></section></details>`, true)}
  ${step('leg-entry', 2, 'Prepare legs', '<section id="sequential-leg-panel" class="panel"></section>')}
  ${step('conditions', 3, 'Weather & fuel', '<section id="weather-panel" class="weather-panel panel"></section><section id="performance-panel" class="performance-panel panel"></section>')}
  ${step('vertical', 4, 'Review OFP', '<button type="button" class="workflow-ofp-button" data-view-ofp>View navigation log</button><section id="vertical-profile-panel" class="vertical-profile-panel panel"></section><details class="menu-subsection" data-menu-section="terrain-airspace"><summary>Terrain &amp; airspace</summary><section id="route-review-panel" class="panel"></section></details>')}
  <details class="phase-disclosure" data-panel-key="saved-plans"><summary><span>PLANS</span><strong>Save &amp; load</strong></summary><section id="saved-plans-panel" class="panel"></section></details>
  <details class="phase-disclosure" data-panel-key="settings">
    <summary><span>SETTINGS</span><div class="workflow-title"><strong>Aircraft &amp; defaults</strong><small data-workflow-summary="settings"></small></div></summary>
    <details class="menu-subsection" data-menu-section="aircraft-defaults"><summary>Cruise power &amp; aircraft defaults</summary><section id="aircraft-settings-panel" class="panel"></section></details>
    <details class="menu-subsection" data-menu-section="vertical-defaults"><summary>Climb &amp; descent defaults</summary><section id="profile-settings-panel" class="panel"></section></details>
    <details class="menu-subsection" data-menu-section="navigation-defaults"><summary>Manual TAS, wind &amp; variation</summary><section id="navigation-panel" class="navigation-panel panel"></section></details>
  </details>`;

/** Summaries describe entered data, not operational readiness. */
export class PlanningWorkflow {
  constructor(private readonly element: HTMLElement, private readonly store: FlightPlanStore) {
    store.subscribe(() => this.render());
    window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, () => this.render());
    this.render();
  }
  render(): void {
    const points = this.store.getWaypoints(), legs = this.store.getLegs();
    const missingPl = legs.filter(l => this.store.getPlannedAltitudeFt(l.from.id, l.to.id) === null).length;
    const missingMsa = legs.filter(l => this.store.getManualMsaFt(l.from.id, l.to.id) === null).length;
    const channels = legs.filter(l => this.store.getManualFrequency(l.from.id, l.to.id)).length;
    const fuel = getFuelPlanningSettings(), aircraft = this.store.getPerformanceSettings();
    const weather = this.store.getWeatherSettings();
    const forecasts = this.store.getWeatherForecasts().length;
    const manual = this.store.getManualLegWinds().length;
    const summaries: Record<string, string> = {
      route: points.length ? `${points[0].name} → ${points.at(-1)!.name} · ${points.length} waypoints` : 'Add your departure airport to start',
      'leg-entry': legs.length ? `${legs.length} legs · ${missingPl ? `${missingPl} missing PL` : 'PL entered'} · ${missingMsa ? `${missingMsa} missing MSA` : 'MSA entered'} · ${channels}/${legs.length} channels` : 'Add at least two waypoints',
      conditions: `${weather.useForecastWinds ? forecasts ? `${forecasts} forecast legs` : manual ? `${manual} manual wind legs` : 'Global wind' : 'Global wind'} · ${fuel.totalFuelOnboardGal === null ? 'Enter fuel onboard' : `${fuel.totalFuelOnboardGal} gal onboard`}`,
      vertical: legs.length ? `${Math.ceil(totalRouteDistanceNm(legs))} NM · ${this.store.getTotalWaypointActivityMinutes()} min pattern` : 'Your navigation log appears below',
      settings: `C182T · ${aircraft.usePohPerformance ? `${aircraft.rpm} RPM · ${aircraft.manifoldPressureInHg} inHg` : 'Manual performance'}`,
    };
    for (const node of this.element.querySelectorAll<HTMLElement>('[data-workflow-summary]')) node.textContent = summaries[node.dataset.workflowSummary!] ?? '';
  }
}
