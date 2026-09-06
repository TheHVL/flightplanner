import './styles.css';
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
      <section class="map-column">
        <div class="map-toolbar">
          <div>
            <span class="toolbar-label">MAP</span>
            <strong>Planning chart</strong>
          </div>
          <div class="map-note">Switch between Kartverket Norgeskart and Avinor ICAO 1:500 000 using the layer control on the map.</div>
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
const tableElement = document.querySelector<HTMLElement>('#ofp-table');
if (!routeElement || !navigationElement || !mapElement || !tableElement) {
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

navigationPanel.render();

const render = () => {
  const waypoints = store.getWaypoints();
  routePanel.render();
  ofpTable.render();
  mapManager.renderRoute(waypoints, (id, lat, lon) => store.updateWaypoint(id, { lat, lon }));
};

store.subscribe(render);
render();
