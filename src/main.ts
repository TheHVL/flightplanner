import './styles.css';
import './mapEnhancements.css';
import { FlightPlanStore } from './flightplan/FlightPlanStore';
import { MapManager } from './map/MapManager';
import { RoutePanel } from './components/RoutePanel';
import { NavigationPanel } from './components/NavigationPanel';
import { OFPTable } from './components/OFPTable';

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
      <div class="phase-chip"><span></span> PHASE 3 · NORWEGIAN MAPS</div>
    </header>

    <main class="workspace">
      <aside class="left-column">
        <section id="route-panel" class="route-panel panel"></section>
        <section id="navigation-panel" class="navigation-panel panel"></section>
      </aside>
      <section id="map-column" class="map-column">
        <div class="map-toolbar">
          <div>
            <span class="toolbar-label">MAP</span>
            <strong>Planning chart</strong>
          </div>
          <div class="map-toolbar-right">
            <div class="map-note">Switch between Kartverket Norgeskart and Avinor ICAO 1:500 000 using the layer control on the map.</div>
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
const mapElement = document.querySelector<HTMLElement>('#map');
const mapColumn = document.querySelector<HTMLElement>('#map-column');
const mapExpandButton = document.querySelector<HTMLButtonElement>('#map-expand');
const tableElement = document.querySelector<HTMLElement>('#ofp-table');
if (!routeElement || !navigationElement || !mapElement || !mapColumn || !mapExpandButton || !tableElement) {
  throw new Error('Failed to mount Flightplanner UI.');
}

const store = new FlightPlanStore();
const routePanel = new RoutePanel(routeElement, store);
const navigationPanel = new NavigationPanel(navigationElement, store);
const ofpTable = new OFPTable(tableElement, store);
const mapManager = new MapManager(mapElement, {
  onMapClick: (lat, lon) => store.addWaypoint({ lat, lon }),
  onWaypointMoved: (id, lat, lon) => store.updateWaypoint(id, { lat, lon }),
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

const render = () => {
  const waypoints = store.getWaypoints();
  routePanel.render();
  ofpTable.render();
  mapManager.renderRoute(waypoints, (id, lat, lon) => store.updateWaypoint(id, { lat, lon }));
};

store.subscribe(render);
render();
