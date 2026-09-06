import './styles.css';
import './mapEnhancements.css';
import './phase4.css';
import { FlightPlanStore } from './flightplan/FlightPlanStore';
import { MapManager, type ChartDetailMode } from './map/MapManager';
import { RoutePanel } from './components/RoutePanel';
import { NavigationPanel } from './components/NavigationPanel';
import { PerformancePanel } from './components/PerformancePanel';
import { OFPTable } from './components/OFPTable';

if ('serviceWorker' in navigator) {
  const serviceWorkerUrl = new URL('sw.js', document.baseURI).toString();
  void navigator.serviceWorker.register(serviceWorkerUrl).catch(() => undefined);
}

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) throw new Error('Missing #app root element.');

root.innerHTML = `
  <div class="app-shell">
    <header class="topbar">
      <div class="brand-lockup">
        <div class="brand-mark">FP</div>
        <div>
          <div class="brand-title">FLIGHTPLANNER</div>
          <div class="brand-subtitle">VFR · NORWAY · TRAINING</div>
        </div>
      </div>
      <div class="phase-chip"><span></span> PHASE 4 · CRUISE PERFORMANCE</div>
    </header>

    <main class="workspace">
      <aside class="left-column">
        <section id="route-panel" class="route-panel panel"></section>
        <section id="navigation-panel" class="navigation-panel panel"></section>
        <section id="performance-panel" class="performance-panel panel"></section>
      </aside>
      <section id="map-column" class="map-column">
        <div class="map-toolbar">
          <div>
            <span class="toolbar-label">MAP</span>
            <strong>Planning chart</strong>
          </div>
          <div class="map-toolbar-right">
            <div class="map-note">Switch between Kartverket Norgeskart and Avinor ICAO 1:500 000 using the layer control on the map.</div>
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
        <div id="map" class="map"></div>
      </section>
    </main>

    <section id="ofp-table" class="ofp-panel panel"></section>
  </div>
`;

const routeElement = document.querySelector<HTMLElement>('#route-panel');
const navigationElement = document.querySelector<HTMLElement>('#navigation-panel');
const performanceElement = document.querySelector<HTMLElement>('#performance-panel');
const mapElement = document.querySelector<HTMLElement>('#map');
const mapColumn = document.querySelector<HTMLElement>('#map-column');
const mapExpandButton = document.querySelector<HTMLButtonElement>('#map-expand');
const chartDetailSelect = document.querySelector<HTMLSelectElement>('#chart-detail');
const tableElement = document.querySelector<HTMLElement>('#ofp-table');
if (
  !routeElement ||
  !navigationElement ||
  !performanceElement ||
  !mapElement ||
  !mapColumn ||
  !mapExpandButton ||
  !chartDetailSelect ||
  !tableElement
) {
  throw new Error('Failed to mount Flightplanner UI.');
}

const store = new FlightPlanStore();
const routePanel = new RoutePanel(routeElement, store);
const navigationPanel = new NavigationPanel(navigationElement, store);
const performancePanel = new PerformancePanel(performanceElement, store);
const ofpTable = new OFPTable(tableElement, store);
const mapManager = new MapManager(mapElement, {
  onMapClick: (lat, lon) => store.addWaypoint({ lat, lon }),
  onWaypointMoved: (id, lat, lon) => store.updateWaypoint(id, { lat, lon }),
});

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
  if (event.key === 'Escape' && mapColumn.classList.contains('map-column--expanded')) {
    setMapExpanded(false);
  }
});

navigationPanel.render();
performancePanel.render();

const render = () => {
  const waypoints = store.getWaypoints();
  routePanel.render();
  ofpTable.render();
  mapManager.renderRoute(waypoints, (id, lat, lon) => store.updateWaypoint(id, { lat, lon }));
};

store.subscribe(render);
render();
