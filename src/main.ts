import './styles.css';
import { FlightPlanStore } from './flightplan/FlightPlanStore';
import { MapManager } from './map/MapManager';
import { RoutePanel } from './components/RoutePanel';
import { OFPTable } from './components/OFPTable';
import { PlanningPanel } from './components/PlanningPanel';
import { MapLayerPanel } from './components/MapLayerPanel';

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
      <div class="phase-chip"><span></span> PHASE 3 · MAP SOURCES</div>
    </header>

    <section id="planning-panel" class="planning-panel panel"></section>

    <main class="workspace">
      <aside id="route-panel" class="route-panel panel"></aside>
      <section class="map-column">
        <div class="map-toolbar map-toolbar-expanded">
          <div class="map-title-group">
            <span class="toolbar-label">MAP</span>
            <strong>Planning chart</strong>
          </div>
          <div id="map-layer-panel" class="map-layer-panel"></div>
        </div>
        <div id="map" class="map"></div>
      </section>
    </main>

    <section id="ofp-table" class="ofp-panel panel"></section>
  </div>
`;

const routeElement = document.querySelector<HTMLElement>('#route-panel');
const mapElement = document.querySelector<HTMLElement>('#map');
const tableElement = document.querySelector<HTMLElement>('#ofp-table');
const planningElement = document.querySelector<HTMLElement>('#planning-panel');
const mapLayerElement = document.querySelector<HTMLElement>('#map-layer-panel');
if (!routeElement || !mapElement || !tableElement || !planningElement || !mapLayerElement) throw new Error('Failed to mount Flightplanner UI.');

const store = new FlightPlanStore();
const routePanel = new RoutePanel(routeElement, store);
const planningPanel = new PlanningPanel(planningElement, store);
const ofpTable = new OFPTable(tableElement, store);
const mapManager = new MapManager(mapElement, {
  onMapClick: (lat, lon) => store.addWaypoint({ lat, lon }),
  onWaypointMoved: (id, lat, lon) => store.updateWaypoint(id, { lat, lon }),
});
const mapLayerPanel = new MapLayerPanel(mapLayerElement, mapManager);

const render = () => {
  const waypoints = store.getWaypoints();
  routePanel.render();
  planningPanel.render();
  ofpTable.render();
  mapLayerPanel.render();
  mapManager.renderRoute(waypoints, (id, lat, lon) => store.updateWaypoint(id, { lat, lon }));
};

store.subscribe(render);
render();
