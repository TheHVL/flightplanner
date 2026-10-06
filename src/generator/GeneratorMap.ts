import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AvinorIcaoLayer } from '../map/MapManager';
import { escapeHtml } from '../utils/html';
import type { RouteCandidate } from './candidates';
/** A preview map with no waypoint editing and no reference to the manual store. */
export class GeneratorMap {
  private readonly map: L.Map;
  private readonly routes: L.LayerGroup;
  constructor(element: HTMLElement) {
    this.map = L.map(element).setView([69.5, 19.2], 7);
    const topo = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', { attribution: '&copy; Kartverket', maxZoom: 19, noWrap: true }).addTo(this.map);
    const icao = new AvinorIcaoLayer({ attribution: 'ICAO 1:500 000 &copy; Avinor' });
    L.control.layers({ 'Norgeskart · Kartverket': topo, 'ICAO 1:500 000 · Avinor': icao }, undefined, { collapsed: true }).addTo(this.map);
    this.routes = L.layerGroup().addTo(this.map);
  }
  show(candidates: RouteCandidate[], selected: string): void {
    this.routes.clearLayers();
    for (const candidate of [...candidates].sort((a, b) => Number(a.id === selected) - Number(b.id === selected))) {
      const chosen = candidate.id === selected;
      const points = candidate.draft.waypoints;
      L.polyline(points.map(p => [p.lat, p.lon] as [number, number]), { color: chosen ? '#2563eb' : '#64748b', weight: chosen ? 4 : 2, opacity: chosen ? 0.95 : 0.35, interactive: false }).addTo(this.routes);
      if (!chosen) continue;
      points.forEach((point, i) => {
        const airport = /^[A-Z]{4}$/.test(point.aipId ?? '');
        L.circleMarker([point.lat, point.lon], { radius: airport ? 7 : 4, color: '#fff', fillColor: airport ? '#162f49' : '#2563eb', fillOpacity: 1, weight: 2 })
          .bindTooltip(`${i + 1}. ${escapeHtml(point.name)}`).addTo(this.routes);
      });
    }
    const chosen = candidates.find(c => c.id === selected);
    if (chosen) this.map.fitBounds(L.latLngBounds(chosen.draft.waypoints.map(p => [p.lat, p.lon] as [number, number])), { padding: [35, 35], maxZoom: 10 });
    this.map.invalidateSize();
  }
}
