import './styles.css';
import './mapEnhancements.css';
import './phase4.css';
import './phase5.css';
import './phase6.css';
import './uxEnhancements.css';
import { FlightPlanStore } from './flightplan/FlightPlanStore';
import { ROUTE_SHAPE_CHANGED_EVENT, RouteShapeController } from './flightplan/RouteShapeController';
import { MapManager, type ChartDetailMode } from './map/MapManager';
import { RoutePanel } from './components/RoutePanel';
import { NavigationPanel } from './components/NavigationPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { WeatherPanel } from './components/WeatherPanel';
import { VerticalProfilePanel } from './components/VerticalProfilePanel';
import { OFPTable } from './components/OFPTable';
import { FUEL_SETTINGS_CHANGED_EVENT, getFuelPlanningSettings } from './fuel/fuelPlanning';
import { buildC182TGlideEnvelopeSamples } from './navigation/glideEnvelope';
import { coordinateAtRouteDistance, trackAtRouteDistance } from './navigation/geodesy';
import { calculateRouteVerticalProfile } from './navigation/verticalProfile';

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
      <div class="phase-chip"><span></span> PHASE 7 · AIP &amp; MSA</div>
    </header>

    <main class="workspace">
      <aside class="left-column">
        <details class="phase-disclosure" data-panel-key="route" open>
          <summary><span>ROUTE</span><strong>Waypoints</strong></summary>
          <section id="route-panel" class="route-panel panel"></section>
        </details>
        <details class="phase-disclosure" data-panel-key="navigation">
          <summary><span>PHASE 2</span><strong>Navigation &amp; wind</strong></summary>
          <section id="navigation-panel" class="navigation-panel panel"></section>
        </details>
        <details class="phase-disclosure" data-panel-key="performance" open>
          <summary><span>PHASE 4</span><strong>Performance &amp; fuel</strong></summary>
          <section id="performance-panel" class="performance-panel panel"></section>
        </details>
        <details class="phase-disclosure" data-panel-key="weather">
          <summary><span>PHASE 5</span><strong>Route weather</strong></summary>
          <section id="weather-panel" class="weather-panel panel"></section>
        </details>
        <details class="phase-disclosure" data-panel-key="vertical">
          <summary><span>PHASE 6/7</span><strong>Vertical profile &amp; AIP</strong></summary>
          <section id="vertical-profile-panel" class="vertical-profile-panel panel"></section>
        </details>
      </aside>
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
            <button id="map-expand" class="map-expand-button" type="button" aria-pressed="false">⛶ Expand map</button>
          </div>
        </div>
        <div id="glide-assumption-bar" class="glide-assumption-bar" hidden>
          <strong>C182T maximum glide, POH Fig. 3-1:</strong>
          propeller windmilling, flaps up, zero wind. The shading uses the Phase 6 modeled altitude and assumes the shoreline/landing surface is at sea level. Best glide speeds shown by the chart are 76 KIAS at 3100 lb, 70 KIAS at 2600 lb and 58 KIAS at 2100 lb. It shows theoretical reach, not terrain clearance or landing suitability.
          <span id="glide-status" class="glide-status"></span>
        </div>
        <div id="map" class="map"></div>
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

const store = new FlightPlanStore();
const routeShapeController = new RouteShapeController(store);
const routePanel = new RoutePanel(routeElement, store);
const navigationPanel = new NavigationPanel(navigationElement, store);
const performancePanel = new PerformancePanel(performanceElement, store);
const weatherPanel = new WeatherPanel(weatherElement, store);
const verticalProfilePanel = new VerticalProfilePanel(verticalProfileElement, store);
const ofpTable = new OFPTable(tableElement, store);
const mapManager = new MapManager(mapElement, {
  onMapClick: (lat, lon) => store.addWaypoint({ lat, lon }),
  onWaypointMoved: (id, lat, lon) => store.updateWaypoint(id, { lat, lon }),
  onRouteLegShape: (legIndex, lat, lon) => routeShapeController.setLegShape(legIndex, { lat, lon }),
});

for (const disclosure of document.querySelectorAll<HTMLDetailsElement>('.phase-disclosure[data-panel-key]')) {
  const key = disclosure.dataset.panelKey;
  if (!key) continue;
  const storageKey = `flightplanner-panel-${key}-open`;
  const saved = localStorage.getItem(storageKey);
  if (saved !== null) disclosure.open = saved === 'true';
  disclosure.addEventListener('toggle', () => {
    localStorage.setItem(storageKey, String(disclosure.open));
    window.requestAnimationFrame(() => mapManager.invalidateSize());
  });
}

const isChartDetailMode = (value: string | null): value is ChartDetailMode =>
  value === 'auto' || value === 'sharp' || value === 'fast';
const savedDetailMode = localStorage.getItem('flightplanner-icao-detail');
const initialDetailMode: ChartDetailMode = isChartDetailMode(savedDetailMode) ? savedDetailMode : 'auto';
chartDetailSelect.value = initialDetailMode;
mapManager.setChartDetail(initialDetailMode);
chartDetailSelect.addEventListener('change', () => {
  const mode = chartDetailSelect.value;
  if (!isChartDetailMode(mode)) return;
  localStorage.setItem('flightplanner-icao-detail', mode);
  mapManager.setChartDetail(mode);
});

const savedMsaCorridor = localStorage.getItem('flightplanner-msa-corridor') === 'true';
msaCorridorToggle.checked = savedMsaCorridor;
mapManager.setMsaCorridorVisible(savedMsaCorridor);
msaCorridorToggle.addEventListener('change', () => {
  localStorage.setItem('flightplanner-msa-corridor', String(msaCorridorToggle.checked));
  mapManager.setMsaCorridorVisible(msaCorridorToggle.checked);
});

const savedGlideEnvelope = localStorage.getItem('flightplanner-glide-envelope') === 'true';
glideEnvelopeToggle.checked = savedGlideEnvelope;
glideAssumptionBar.hidden = !savedGlideEnvelope;
mapManager.setGlideEnvelopeVisible(savedGlideEnvelope);
glideEnvelopeToggle.addEventListener('change', () => {
  localStorage.setItem('flightplanner-glide-envelope', String(glideEnvelopeToggle.checked));
  glideAssumptionBar.hidden = !glideEnvelopeToggle.checked;
  mapManager.setGlideEnvelopeVisible(glideEnvelopeToggle.checked);
  renderGlideEnvelope();
});

const MIN_WORKSPACE_HEIGHT = 480;
const MAX_WORKSPACE_HEIGHT = 1000;
const defaultWorkspaceHeight = Math.min(700, Math.max(560, window.innerHeight - 180));
const savedWorkspaceHeight = Number(localStorage.getItem('flightplanner-workspace-height'));

const setWorkspaceHeight = (height: number, persist = false) => {
  const clamped = Math.round(Math.min(MAX_WORKSPACE_HEIGHT, Math.max(MIN_WORKSPACE_HEIGHT, height)));
  workspace.style.setProperty('--workspace-height', `${clamped}px`);
  mapResizeHandle.setAttribute('aria-valuenow', String(clamped));
  if (persist) localStorage.setItem('flightplanner-workspace-height', String(clamped));
  window.requestAnimationFrame(() => mapManager.invalidateSize());
};

setWorkspaceHeight(Number.isFinite(savedWorkspaceHeight) && savedWorkspaceHeight > 0 ? savedWorkspaceHeight : defaultWorkspaceHeight);

let resizePointerId: number | null = null;
let resizeStartY = 0;
let resizeStartHeight = 0;

const finishMapResize = () => {
  if (resizePointerId === null) return;
  resizePointerId = null;
  document.body.classList.remove('map-resizing');
  const currentHeight = workspace.getBoundingClientRect().height;
  setWorkspaceHeight(currentHeight, true);
};

mapResizeHandle.addEventListener('pointerdown', (event) => {
  if (window.matchMedia('(max-width: 900px)').matches) return;
  resizePointerId = event.pointerId;
  resizeStartY = event.clientY;
  resizeStartHeight = workspace.getBoundingClientRect().height;
  mapResizeHandle.setPointerCapture(event.pointerId);
  document.body.classList.add('map-resizing');
  event.preventDefault();
});

mapResizeHandle.addEventListener('pointermove', (event) => {
  if (resizePointerId !== event.pointerId) return;
  setWorkspaceHeight(resizeStartHeight + event.clientY - resizeStartY);
});

mapResizeHandle.addEventListener('pointerup', (event) => {
  if (resizePointerId !== event.pointerId) return;
  if (mapResizeHandle.hasPointerCapture(event.pointerId)) {
    mapResizeHandle.releasePointerCapture(event.pointerId);
  }
  finishMapResize();
});

mapResizeHandle.addEventListener('pointercancel', finishMapResize);
mapResizeHandle.addEventListener('dblclick', () => setWorkspaceHeight(defaultWorkspaceHeight, true));
mapResizeHandle.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
  event.preventDefault();
  const currentHeight = workspace.getBoundingClientRect().height;
  const delta = event.key === 'ArrowUp' ? -20 : 20;
  setWorkspaceHeight(currentHeight + delta, true);
});

const setMapExpanded = (expanded: boolean) => {
  mapColumn.classList.toggle('map-column--expanded', expanded);
  document.body.classList.toggle('map-overlay-open', expanded);
  mapExpandButton.setAttribute('aria-pressed', String(expanded));
  mapExpandButton.textContent = expanded ? '× Exit large map' : '⛶ Expand map';
  window.requestAnimationFrame(() => mapManager.invalidateSize());
};

mapExpandButton.addEventListener('click', () => {
  setMapExpanded(!mapColumn.classList.contains('map-column--expanded'));
});

document.addEventListener('keydown', (event) => {
  const undoShortcut =
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'z';

  if (undoShortcut) {
    event.preventDefault();
    const target = event.target;
    if (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    ) {
      target.blur();
    }
    if (!routeShapeController.undoImmediateShape()) store.undoLastAction();
    return;
  }

  if (event.key === 'Escape' && mapColumn.classList.contains('map-column--expanded')) {
    setMapExpanded(false);
  }
});

navigationPanel.render();
performancePanel.render();
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

const renderVerticalProfileMarkers = () => {
  try {
    const current = calculateCurrentVerticalProfile();
    if (!current) {
      mapManager.renderVerticalProfileMarkers([]);
      return;
    }
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
  }
};

const renderGlideEnvelope = () => {
  if (!glideEnvelopeToggle.checked) {
    mapManager.renderGlideEnvelope([]);
    glideStatus.textContent = '';
    return;
  }

  try {
    const current = calculateCurrentVerticalProfile();
    if (!current) {
      mapManager.renderGlideEnvelope([]);
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
      glideStatus.textContent = result.warnings[0] ?? 'Enter PL for the route to draw the envelope.';
      return;
    }

    const warning = result.warnings.length > 0 ? ` ${result.warnings.join(' ')}` : '';
    glideStatus.textContent = `Current modeled maximum reach is up to ${result.maxRangeNm.toFixed(1)} NM from the route.${warning}`;
  } catch (error) {
    mapManager.renderGlideEnvelope([]);
    glideStatus.textContent = error instanceof Error ? error.message : 'Glide overlay could not be calculated.';
  }
};

const enhanceVerticalPanel = () => {
  for (const select of verticalProfileElement.querySelectorAll<HTMLSelectElement>('[data-vertical-waypoint-mode]')) {
    const airportOption = select.querySelector<HTMLOptionElement>('option[value="airport"]');
    const circuitOption = select.querySelector<HTMLOptionElement>('option[value="circuits"]');
    if (airportOption) airportOption.textContent = 'Airport / T&G';
    if (circuitOption) circuitOption.textContent = 'Airport + circuits (1000 ft AGL)';
  }

  const sectionHint = verticalProfileElement.querySelector<HTMLElement>('.vertical-waypoint-section .vertical-section-title span');
  if (sectionHint) {
    sectionHint.textContent = 'Airport / T&G models the airport visit without added circuit time. Airport + circuits uses the same airport descent/climb and adds circuit time/fuel; standard circuit altitude is 1000 ft AGL.';
  }

  for (const controls of verticalProfileElement.querySelectorAll<HTMLElement>('.vertical-circuit-controls')) {
    if (controls.querySelector('.circuit-standard-note')) continue;
    const row = controls.closest<HTMLElement>('.vertical-waypoint-row');
    const elevationInput = row?.querySelector<HTMLInputElement>('[data-vertical-waypoint-elevation]');
    const elevationFt = elevationInput?.value ? Number(elevationInput.value) : null;
    const altitudeText = elevationFt !== null && Number.isFinite(elevationFt)
      ? `${Math.round(elevationFt + 1000).toLocaleString()} ft AMSL (1000 ft AGL)`
      : 'field elevation + 1000 ft AGL';
    const note = document.createElement('div');
    note.className = 'circuit-standard-note';
    note.textContent = `Standard circuit altitude: ${altitudeText}.`;
    controls.append(note);
  }
};

const fixOfpFuelRemainingColumn = () => {
  for (const row of tableElement.querySelectorAll<HTMLTableRowElement>('tbody tr')) {
    if (row.cells.length !== 24) continue;
    const estimatedCell = Array.from(row.cells).find((cell) => cell.title.startsWith('Estimated fuel remaining'));
    if (!estimatedCell) continue;
    const diffCell = document.createElement('td');
    diffCell.className = 'pending';
    diffCell.title = 'Time difference between actual and estimated time.';
    diffCell.textContent = '—';
    estimatedCell.before(diffCell);
  }
};

const render = () => {
  const waypoints = store.getWaypoints();
  const legs = store.getLegs();
  routePanel.render();
  ofpTable.render();
  enhanceVerticalPanel();
  fixOfpFuelRemainingColumn();
  mapManager.renderMsaCorridor(legs);
  mapManager.renderRoute(waypoints, legs, (id, lat, lon) => store.updateWaypoint(id, { lat, lon }));
  renderVerticalProfileMarkers();
  renderGlideEnvelope();
};

store.subscribe(render);
window.addEventListener(FUEL_SETTINGS_CHANGED_EVENT, render);
window.addEventListener(ROUTE_SHAPE_CHANGED_EVENT, render);
render();
