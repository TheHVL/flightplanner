import { readPreference, writePreference } from './utils/preferences';
import './styles.css';
import './mapEnhancements.css';
import './performance.css';
import './verticalProfile.css';
import './weather.css';
import './uxEnhancements.css';
import './aipPlanning.css';
import './sidebarLayout.css';
import './savedPlans.css';
import './planningMenus.css';
import './frequencies.css';
import './planningWorkflow.css';
import './routeIssues.css';
import './readability.css';
import { publishedMapPoints, type PublishedMapPoint } from './aip/mapPoints';
import { PlanningWorkflow, planningSidebarMarkup } from './components/PlanningWorkflow';
import { LEG_SELECTED, openLegEditor } from './components/legEditorEvents';
import { FrequencyPlanner } from './frequencies/FrequencyPlanner';
import { FrequencyPanel } from './components/FrequencyPanel';
import { FlightPlanStore } from './flightplan/FlightPlanStore';
import { ROUTE_SHAPE_CHANGED_EVENT, RouteShapeController } from './flightplan/RouteShapeController';
import { WorkingRouteStatus } from './components/WorkingRouteStatus';
import { PlanningHistory } from './components/PlanningHistory';
import { MapManager, type ChartDetailMode } from './map/MapManager';
import { RoutePanel } from './components/RoutePanel';
import { NavigationPanel } from './components/NavigationPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { WeatherPanel } from './components/WeatherPanel';
import { VerticalProfilePanel } from './components/VerticalProfilePanel';
import { OFPTable } from './components/OFPTable';
import { AipPanel } from './components/AipPanel';
import { SequentialLegPanel } from './components/SequentialLegPanel';
import { initializeWorkspaceLayout } from './components/WorkspaceLayout';
import { PlanLibraryPanel } from './components/PlanLibraryPanel';
import { RouteReviewPanel } from './components/RouteReviewPanel';
import { importGeneratedRoute } from './generator/transfer';
import { FUEL_SETTINGS_CHANGED_EVENT, getFuelPlanningSettings } from './fuel/fuelPlanning';
import { buildC182TGlideEnvelopeSamples } from './navigation/glideEnvelope';
import { analyzeGlideCoastline, loadNordicLandMask } from './navigation/glideCoastline';
import { coordinateAtRouteDistance, trackAtRouteDistance } from './navigation/geodesy';
import { calculateRouteVerticalProfile } from './navigation/verticalProfile';
import { calculateVerticalProfileConflicts, formatVerticalConflict } from './navigation/verticalConflicts';

if ('serviceWorker' in navigator) {
  const serviceWorkerUrl = new URL('sw.js', document.baseURI).toString();
  void navigator.serviceWorker.register(serviceWorkerUrl).catch(() => undefined);
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element.');

root.innerHTML = `
  <div id="planning-warning" class="planning-warning-overlay">
    <div class="planning-warning-dialog" role="dialog" aria-modal="true" aria-labelledby="planning-warning-title" aria-describedby="planning-warning-text">
      <p class="eyebrow">IMPORTANT SAFETY NOTICE</p>
      <h1 id="planning-warning-title">Unapproved planning aid</h1>
      <p id="planning-warning-text">
        Flightplanner is an experimental training and planning aid. It is not approved, certified, or guaranteed to be accurate or current, and it must not be used as the sole basis for flight planning or operational decisions. Verify all calculations and information against the current aircraft POH/AFM, official AIP, NOTAM, approved weather briefing, applicable regulations, and required operational procedures.
      </p>
      <button id="planning-warning-ack" type="button">I understand and want to continue</button>
    </div>
  </div>

  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">FP</div>
        <div>
          <div class="brand-title">FLIGHTPLANNER</div>
          <div class="brand-subtitle">VFR · NORWAY · TRAINING</div>
        </div>
      </div>
      <div class="phase-chip"><span></span> VFR FLIGHT PLANNING</div>
    </header>

    <div class="planning-toolbar"><div id="plan-history" aria-label="Plan history"></div><div id="working-route-status" role="status" aria-live="polite"></div></div>
    <p id="generator-import-status" class="generator-import-status" role="status" hidden></p>
    <main class="workspace">
      <aside id="planning-sidebar" class="left-column">
        ${planningSidebarMarkup}
      </aside>
      <div id="sidebar-resize-handle" class="sidebar-resize-handle" role="separator" tabindex="0"
        aria-orientation="vertical" aria-label="Resize planning sidebar" aria-controls="planning-sidebar"
        title="Drag left or right to resize the sidebar. Arrow keys also resize. Double-click to reset."></div>
      <section id="map-column" class="map-column">
        <div class="map-toolbar">
          <div>
            <span class="toolbar-label">MAP</span>
            <strong>Planning chart</strong>
          </div>
          <div class="map-toolbar-right">
            <div class="map-note">Switch between Kartverket Norgeskart and Avinor ICAO 1:500 000 using the layer control on the map.</div>
            <label class="msa-corridor-control" title="Show a visual corridor extending 1 NM either side of the flown route. Use it to inspect terrain and obstacles manually.">
              <input id="msa-corridor-toggle" type="checkbox" />
              <span>MSA ±1 NM</span>
            </label>
            <label class="glide-envelope-control" title="Show the approximate C182T zero-wind maximum-glide reach from the modeled route altitude. This is a visual planning aid, not a landing guarantee.">
              <input id="glide-envelope-toggle" type="checkbox" />
              <span>C182T glide</span>
            </label>
            <label class="chart-detail-control">
              <span>ICAO detail</span>
              <select id="chart-detail" aria-label="ICAO chart detail">
                <option value="auto">Auto</option>
                <option value="sharp">Sharp</option>
                <option value="fast">Fast</option>
              </select>
            </label>
            <label class="msa-corridor-control" title="Click a published point, or click/drag within 14 pixels and 0.5 NM to snap. Zoom in for reporting points. Turn off for free placement.">
              <input id="aip-snap-toggle" type="checkbox" checked />
              <span>Snap to AIP points</span>
            </label>
            <button id="map-delete-route" class="map-delete-route-button" type="button" disabled>Delete route</button>
            <button id="map-expand" class="map-expand-button" type="button" aria-pressed="false">⛶ Expand map</button>
          </div>
        </div>
        <div id="glide-assumption-bar" class="glide-assumption-bar" hidden>
          <strong>C182T maximum glide, POH Fig. 3-1:</strong>
          propeller windmilling, flaps up, zero wind. The blue shading uses the modeled route altitude and assumes the shoreline/landing surface is at sea level. Red route sections indicate sampled over-water positions where no coastline is found inside the modeled zero-wind glide range; amber dashed sections indicate a modeled coastline margin of 1 NM or less. Coastline screening uses generalized Natural Earth 1:10m land data and may omit small islands or fine shoreline detail. Best glide speeds shown by the chart are 76 KIAS at 3100 lb, 70 KIAS at 2600 lb and 58 KIAS at 2100 lb. This is not terrain-clearance or landing-suitability analysis.
          <span id="glide-status" class="glide-status"></span>
        </div>
        <div id="map" class="map"></div>
        <p class="aip-map-help" id="aip-map-status">Loading AIP map points…</p>
        <div
          id="map-resize-handle"
          class="map-resize-handle"
          role="separator"
          tabindex="0"
          aria-orientation="horizontal"
          aria-label="Resize map and planning workspace"
          aria-valuemin="480"
          aria-valuemax="1000"
          title="Drag up or down to resize the map. Double-click to reset."
        ></div>
      </section>
    </main>

    <section id="ofp-table" class="ofp-panel panel"></section>
  </div>
`;

const warningOverlay = document.querySelector<HTMLElement>('#planning-warning');
const warningAck = document.querySelector<HTMLButtonElement>('#planning-warning-ack');
const workspace = document.querySelector<HTMLElement>('.workspace');
const routeElement = document.querySelector<HTMLElement>('#route-panel');
const navigationElement = document.querySelector<HTMLElement>('#navigation-panel');
const performanceElement = document.querySelector<HTMLElement>('#performance-panel');
const weatherElement = document.querySelector<HTMLElement>('#weather-panel');
const verticalProfileElement = document.querySelector<HTMLElement>('#vertical-profile-panel');
const mapElement = document.querySelector<HTMLElement>('#map');
const mapColumn = document.querySelector<HTMLElement>('#map-column');
const mapDeleteRouteButton = document.querySelector<HTMLButtonElement>('#map-delete-route');
const mapExpandButton = document.querySelector<HTMLButtonElement>('#map-expand');
const mapResizeHandle = document.querySelector<HTMLElement>('#map-resize-handle');
const chartDetailSelect = document.querySelector<HTMLSelectElement>('#chart-detail');
const msaCorridorToggle = document.querySelector<HTMLInputElement>('#msa-corridor-toggle');
const glideEnvelopeToggle = document.querySelector<HTMLInputElement>('#glide-envelope-toggle');
const glideAssumptionBar = document.querySelector<HTMLElement>('#glide-assumption-bar');
const glideStatus = document.querySelector<HTMLElement>('#glide-status');
const tableElement = document.querySelector<HTMLElement>('#ofp-table');
if (
  !warningOverlay ||
  !warningAck ||
  !workspace ||
  !routeElement ||
  !navigationElement ||
  !performanceElement ||
  !weatherElement ||
  !verticalProfileElement ||
  !mapElement ||
  !mapColumn ||
  !mapDeleteRouteButton ||
  !mapExpandButton ||
  !mapResizeHandle ||
  !chartDetailSelect ||
  !msaCorridorToggle ||
  !glideEnvelopeToggle ||
  !glideAssumptionBar ||
  !glideStatus ||
  !tableElement
) {
  throw new Error('Failed to mount Flightplanner UI.');
}

warningAck.addEventListener('click', () => {
  warningOverlay.hidden = true;
});
window.setTimeout(() => warningAck.focus(), 0);

const store = new FlightPlanStore(2500);
const moveMapWaypoint = (id: string, lat: number, lon: number, point?: PublishedMapPoint) => store.updateWaypoint(id, { lat, lon }, point);
const frequencyPlanner = new FrequencyPlanner(store);
const routeShapeController = new RouteShapeController(store);
const workingRouteStatus = new WorkingRouteStatus(document.querySelector<HTMLElement>('#working-route-status')!, store, routeShapeController);
workingRouteStatus.restore();
new PlanningHistory(document.querySelector<HTMLElement>('#plan-history')!, store);
const transferToken = new URL(location.href).searchParams.get('generatedRoute');
if (transferToken) {
  const message = document.querySelector<HTMLElement>('#generator-import-status')!;
  try {
    if (importGeneratedRoute(transferToken, sessionStorage, localStorage, store, routeShapeController)) {
      message.textContent = 'Generated draft imported. Review chart joins, MSA and frequencies, then set the forecast date/time and fetch fresh winds. Your previous manual plan is available under Save & load → Restore previous work.';
      workingRouteStatus.save();
    }
  } catch (error) { message.textContent = error instanceof Error ? error.message : 'Generated draft could not be imported. Your manual plan was kept.'; }
  message.hidden = false;
  const cleanUrl = new URL(location.href); cleanUrl.searchParams.delete('generatedRoute'); history.replaceState(null, '', cleanUrl);
}
const routePanel = new RoutePanel(routeElement, store);
const legEditor = new SequentialLegPanel(document.querySelector<HTMLElement>('#sequential-leg-panel')!, store);
const embeddedFrequency = new FrequencyPanel(document.querySelector<HTMLElement>('[data-leg-frequency]')!, store, frequencyPlanner, true);
const visitPanel = new VerticalProfilePanel(document.querySelector<HTMLElement>('[data-waypoint-visit]')!, store, 'waypoint');
legEditor.onSelection((fromId, toId) => embeddedFrequency.selectLeg(fromId, toId));
window.dispatchEvent(new CustomEvent('flightplanner-select-waypoint-visit', { detail: { waypointId: legEditor.getSelectedLeg().toId } }));
visitPanel.render();
new PlanningWorkflow(document.querySelector<HTMLElement>('#planning-sidebar')!, store);
new AipPanel(document.querySelector<HTMLElement>('#aip-panel')!, store, catalog => {
  mapManager.setPublishedPoints(publishedMapPoints(catalog));
  document.querySelector('#aip-map-status')!.textContent = 'Click AIP points to add them. Zoom in for reporting points. Nearby clicks and waypoint drops snap to published coordinates.';
}, () => {
  document.querySelector('#aip-map-status')!.textContent = 'AIP map points could not be loaded. Check deployed data in Build route; free placement remains available.';
});
const navigationPanel = new NavigationPanel(navigationElement, store);
const performancePanel = new PerformancePanel(performanceElement, store, 'fuel');
const aircraftSettingsPanel = new PerformancePanel(document.querySelector<HTMLElement>('#aircraft-settings-panel')!, store, 'settings');
const profileSettingsPanel = new VerticalProfilePanel(document.querySelector<HTMLElement>('#profile-settings-panel')!, store, 'settings');
const weatherPanel = new WeatherPanel(weatherElement, store);
const verticalProfilePanel = new VerticalProfilePanel(verticalProfileElement, store, 'profile');
new PlanLibraryPanel(document.querySelector<HTMLElement>('#saved-plans-panel')!, store, routeShapeController, () => {
  legEditor.onPlanLoaded();
  navigationPanel.render();
  performancePanel.render();
  aircraftSettingsPanel.render();
  profileSettingsPanel.render();
  weatherPanel.onPlanLoaded();
  void frequencyPlanner.reload();
  verticalProfilePanel.render();
});
const ofpTable = new OFPTable(tableElement, store);
frequencyPlanner.subscribe(() => ofpTable.render());
void frequencyPlanner.reload();
const mapManager = new MapManager(mapElement, {
  onMapClick: (lat, lon, point) => {
    if (point) {
      const last = store.getWaypoints().at(-1);
      if (last?.aipId === point.aipId && last.lat === point.lat && last.lon === point.lon) return;
      store.appendAipWaypoints([point]);
    } else store.addWaypoint({ lat, lon });
  },
  onWaypointMoved: moveMapWaypoint,
  onRouteLegShape: (legIndex, lat, lon) => routeShapeController.setLegShape(legIndex, { lat, lon }),
  onWaypointInserted: (fromId, toId, lat, lon, point) => {
    routeShapeController.insertWaypointIntoLeg(fromId, toId, { lat, lon }, point);
  },
  onLegSelected: index => { const leg = store.getLegs()[index]; if (leg) openLegEditor({ fromId: leg.from.id, toId: leg.to.id }); },
  onWaypointSelected: id => {
    const leg = store.getLegs().find(l => l.to.id === id) ?? store.getLegs().find(l => l.from.id === id);
    if (leg) openLegEditor({ fromId: leg.from.id, toId: leg.to.id, focus: 'waypoint', waypointId: id });
  },
});
document.querySelector<HTMLInputElement>('#aip-snap-toggle')!.addEventListener('change', event => {
  mapManager.setSnapEnabled((event.target as HTMLInputElement).checked);
});

window.addEventListener(LEG_SELECTED, () => mapManager.setSelectedLeg(legEditor.getSelectedLeg()));
new RouteReviewPanel(document.querySelector<HTMLElement>('#route-review-panel')!, store, frequencyPlanner, {
  onIssues: (issues, legs) => mapManager.renderRouteIssues(issues, legs),
  onFocusIssue: (issue, legs) => mapManager.focusRouteIssue(issue, legs),
});
document.querySelector('[data-view-ofp]')!.addEventListener('click', () => {
  tableElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
  tableElement.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
});

for (const disclosure of document.querySelectorAll<HTMLDetailsElement>('.phase-disclosure[data-panel-key]')) {
  const key = disclosure.dataset.panelKey;
  if (!key) continue;
  const storageKey = `flightplanner-panel-${key}-open`;
  const saved = readPreference(storageKey);
  if (saved !== null) disclosure.open = saved === 'true';
  disclosure.addEventListener('toggle', () => {
    writePreference(storageKey, String(disclosure.open));
    window.requestAnimationFrame(() => mapManager.invalidateSize());
  });
}

document.querySelector('#collapse-planning-menus')!.addEventListener('click', () => {
  for (const panel of document.querySelectorAll<HTMLDetailsElement>('.phase-disclosure[data-panel-key]')) panel.open = false;
});

const isChartDetailMode = (value: string | null): value is ChartDetailMode =>
  value === 'auto' || value === 'sharp' || value === 'fast';
const savedDetailMode = readPreference('flightplanner-icao-detail');
const initialDetailMode: ChartDetailMode = isChartDetailMode(savedDetailMode) ? savedDetailMode : 'auto';
chartDetailSelect.value = initialDetailMode;
mapManager.setChartDetail(initialDetailMode);
chartDetailSelect.addEventListener('change', () => {
  const mode = chartDetailSelect.value;
  if (!isChartDetailMode(mode)) return;
  writePreference('flightplanner-icao-detail', mode);
  mapManager.setChartDetail(mode);
});

const savedMsaCorridor = readPreference('flightplanner-msa-corridor') === 'true';
msaCorridorToggle.checked = savedMsaCorridor;
mapManager.setMsaCorridorVisible(savedMsaCorridor);
msaCorridorToggle.addEventListener('change', () => {
  writePreference('flightplanner-msa-corridor', String(msaCorridorToggle.checked));
  mapManager.setMsaCorridorVisible(msaCorridorToggle.checked);
});

const savedGlideEnvelope = readPreference('flightplanner-glide-envelope') === 'true';
glideEnvelopeToggle.checked = savedGlideEnvelope;
glideAssumptionBar.hidden = !savedGlideEnvelope;
mapManager.setGlideEnvelopeVisible(savedGlideEnvelope);
glideEnvelopeToggle.addEventListener('change', () => {
  writePreference('flightplanner-glide-envelope', String(glideEnvelopeToggle.checked));
  glideAssumptionBar.hidden = !glideEnvelopeToggle.checked;
  mapManager.setGlideEnvelopeVisible(glideEnvelopeToggle.checked);
  void renderGlideEnvelope();
});

initializeWorkspaceLayout(workspace, mapColumn, mapResizeHandle, mapExpandButton, () => mapManager.invalidateSize());

mapDeleteRouteButton.addEventListener('click', () => {
  if (store.getWaypoints().length === 0) return;
  const confirmed = window.confirm('Delete the entire route and its route-specific planning data?');
  if (!confirmed) return;
  store.clear();
});

navigationPanel.render();
performancePanel.render();
aircraftSettingsPanel.render();
profileSettingsPanel.render();
weatherPanel.render();
verticalProfilePanel.render();

const calculateCurrentVerticalProfile = () => {
  const legs = store.getLegs();
  if (legs.length === 0) return null;
  const plannedAltitudesFt = legs.map((leg) => store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
  const fuelSettings = getFuelPlanningSettings();
  const profile = calculateRouteVerticalProfile({
    legs,
    plannedAltitudesFt,
    waypointConstraints: store.getVerticalWaypointConstraints(),
    ...store.getVerticalProfileSettings(),
    climbPerformanceMode: fuelSettings.climbPerformanceMode,
    climbOatC: store.getPerformanceSettings().oatC,
  });
  return { legs, plannedAltitudesFt, profile };
};

const sampleRouteSection = (
  legs: ReturnType<FlightPlanStore['getLegs']>,
  startNm: number,
  endNm: number,
) => {
  const distanceNm = Math.max(0, endNm - startNm);
  const steps = Math.max(1, Math.ceil(distanceNm / 0.5));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const routeDistanceNm = startNm + distanceNm * (index / steps);
    return coordinateAtRouteDistance(legs, routeDistanceNm);
  }).filter((coordinate): coordinate is NonNullable<typeof coordinate> => coordinate !== null);
};

const renderVerticalProfileMarkers = () => {
  try {
    const current = calculateCurrentVerticalProfile();
    if (!current) {
      mapManager.renderVerticalProfileMarkers([]);
      mapManager.renderVerticalProfileConflicts([]);
      return;
    }

    const conflicts = calculateVerticalProfileConflicts(current.profile);
    mapManager.renderVerticalProfileConflicts(
      conflicts.map((conflict) => ({
        id: conflict.id,
        coordinates: sampleRouteSection(current.legs, conflict.startNm, conflict.endNm),
        title: formatVerticalConflict(conflict),
      })),
    );

    mapManager.renderVerticalProfileMarkers(
      current.profile.events
        .filter((event) => event.onRoute)
        .map((event) => {
          const coordinate = coordinateAtRouteDistance(current.legs, event.routeDistanceNm);
          if (!coordinate) return null;
          return {
            id: event.id,
            type: event.type,
            coordinate,
            trueTrackDeg: trackAtRouteDistance(current.legs, event.routeDistanceNm),
            title: `${event.type}: ${event.distanceFromWaypointNm.toFixed(1)} NM ${event.position} ${event.waypointName}, ${Math.round(event.altitudeFromFt)} → ${Math.round(event.altitudeToFt)} ft`,
          };
        })
        .filter((marker): marker is NonNullable<typeof marker> => marker !== null),
    );
  } catch {
    mapManager.renderVerticalProfileMarkers([]);
    mapManager.renderVerticalProfileConflicts([]);
  }
};

let glideRenderSequence = 0;

const renderGlideEnvelope = async () => {
  const sequence = ++glideRenderSequence;
  if (!glideEnvelopeToggle.checked) {
    mapManager.renderGlideEnvelope([]);
    mapManager.renderGlideCoastlineSegments([]);
    glideStatus.textContent = '';
    return;
  }

  try {
    const current = calculateCurrentVerticalProfile();
    if (!current) {
      mapManager.renderGlideEnvelope([]);
      mapManager.renderGlideCoastlineSegments([]);
      glideStatus.textContent = 'Add at least two waypoints and enter PL to draw the envelope.';
      return;
    }
    const result = buildC182TGlideEnvelopeSamples({
      legs: current.legs,
      plannedAltitudesFt: current.plannedAltitudesFt,
      verticalProfile: current.profile,
    });
    mapManager.renderGlideEnvelope(result.samples);

    if (result.samples.length === 0) {
      mapManager.renderGlideCoastlineSegments([]);
      glideStatus.textContent = result.warnings[0] ?? 'Enter PL for the route to draw the envelope.';
      return;
    }

    const envelopeWarning = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    glideStatus.textContent = `Current modeled maximum reach is up to ${result.maxRangeNm.toFixed(1)} NM from the route. Analyzing coastline...${envelopeWarning}`;

    try {
      const landMaskUrl = new URL('data/ne_10m_land_nordic.geojson', document.baseURI).toString();
      const landMask = await loadNordicLandMask(landMaskUrl);
      if (sequence !== glideRenderSequence || !glideEnvelopeToggle.checked) return;

      const coastline = analyzeGlideCoastline(result.samples, landMask);
      mapManager.renderGlideCoastlineSegments(coastline.mapSegments);

      let coastlineStatus = '';
      if (coastline.unreachableSampleCount > 0) {
        coastlineStatus =
          ` Approx. ${coastline.estimatedUnreachableRouteNm.toFixed(1)} NM of the sampled route has no coastline inside the modeled zero-wind glide range; red route sections mark the screening result.`;
        if (coastline.marginalSampleCount > 0) {
          coastlineStatus +=
            ` A further approx. ${coastline.estimatedMarginalRouteNm.toFixed(1)} NM has 1 NM or less modeled coastline margin and is shown amber/dashed.`;
        }
      } else if (coastline.marginalSampleCount > 0) {
        coastlineStatus =
          ` Coastline is inside the modeled range at sampled over-water positions, but approx. ${coastline.estimatedMarginalRouteNm.toFixed(1)} NM has 1 NM or less modeled margin and is shown amber/dashed.`;
      } else if (coastline.waterSampleCount > 0) {
        const margin = coastline.minimumReachableMarginNm === null
          ? ''
          : ` Smallest modeled coastline margin is ${coastline.minimumReachableMarginNm.toFixed(1)} NM.`;
        coastlineStatus =
          ` All sampled over-water positions have coastline inside the modeled zero-wind glide range.${margin}`;
      } else {
        coastlineStatus = ' No sampled over-water route positions were detected by the bundled land mask.';
      }

      const coverageWarning = coastline.outsideCoverageSampleCount > 0
        ? ` ${coastline.outsideCoverageSampleCount} sample(s) are outside dataset coverage.`
        : '';
      glideStatus.textContent =
        `Current modeled maximum reach is up to ${result.maxRangeNm.toFixed(1)} NM from the route.${coastlineStatus}${coverageWarning}${envelopeWarning}`;
    } catch (coastlineError) {
      if (sequence !== glideRenderSequence || !glideEnvelopeToggle.checked) return;
      mapManager.renderGlideCoastlineSegments([]);
      const message = coastlineError instanceof Error ? coastlineError.message : 'unknown coastline-data error';
      glideStatus.textContent =
        `Current modeled maximum reach is up to ${result.maxRangeNm.toFixed(1)} NM from the route. Coastline screening unavailable: ${message}.${envelopeWarning}`;
    }
  } catch (error) {
    if (sequence !== glideRenderSequence) return;
    mapManager.renderGlideEnvelope([]);
    mapManager.renderGlideCoastlineSegments([]);
    glideStatus.textContent = error instanceof Error ? error.message : 'Glide overlay could not be calculated.';
  }
};

const render = () => {
  const waypoints = store.getWaypoints();
  const legs = store.getLegs();
  mapDeleteRouteButton.disabled = waypoints.length === 0;
  routePanel.render();
  ofpTable.render();
  mapManager.renderMsaCorridor(legs);
  mapManager.renderRoute(waypoints, legs, moveMapWaypoint, waypoint => store.isAirportWaypoint(waypoint.id));
  mapManager.setSelectedLeg(legEditor.getSelectedLeg());
  renderVerticalProfileMarkers();
  void renderGlideEnvelope();
};

store.subscribe(() => {
  workingRouteStatus.save();
  render();
});
window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, render);
window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, () => {
  workingRouteStatus.save();
  render();
});
render();
