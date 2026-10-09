import L from 'leaflet';
import { densifyRoutePath, routeLegPath } from '../navigation/geodesy';
import 'leaflet/dist/leaflet.css';
import { AvinorIcaoLayer } from '../map/MapManager';
import { airportRouteSectors } from '../map/routeSectors';
import { escapeHtml } from '../utils/html';
import { terrainResolutionLabel } from './terrainSummary';
import type { RouteCandidate } from './candidates';
import { issueRouteCoordinates, issueSeverityLabel, type RouteIssue } from '../routing/issues';
/** A preview map with no waypoint editing and no reference to the manual store. */
export class GeneratorMap {
  private readonly map: L.Map;
  private readonly routes: L.LayerGroup;
  private readonly notice: L.LayerGroup;
  private readonly terrainBadge: HTMLElement;
  constructor(element: HTMLElement) {
    this.map = L.map(element).setView([69.5, 19.2], 7);
    const topo = L.tileLayer('https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png', { attribution: '&copy; Kartverket', maxZoom: 19, noWrap: true }).addTo(this.map);
    const icao = new AvinorIcaoLayer({ attribution: 'ICAO 1:500 000 &copy; Avinor' });
    L.control.layers({ 'Norgeskart · Kartverket': topo, 'ICAO 1:500 000 · Avinor': icao }, undefined, { collapsed: true }).addTo(this.map);
    this.routes = L.layerGroup().addTo(this.map);
    this.notice = L.layerGroup().addTo(this.map);
    this.terrainBadge = L.DomUtil.create('div', 'generator-terrain-badge');
    this.terrainBadge.hidden = true;
    const badge = new L.Control({ position: 'bottomleft' });
    badge.onAdd = () => this.terrainBadge;
    badge.addTo(this.map);
  }
  show(candidates: RouteCandidate[], selected: string, issues: RouteIssue[] = []): void {
    this.routes.clearLayers();
    this.notice.clearLayers();
    for (const candidate of [...candidates].sort((a, b) => Number(a.id === selected) - Number(b.id === selected))) {
      const chosen = candidate.id === selected;
      const points = candidate.draft.waypoints;
      for (const sector of airportRouteSectors(candidate.legs)) {
        L.polyline(sector.legs.flatMap(leg => densifyRoutePath(routeLegPath(leg))).map(p => [p.lat, p.lon] as [number, number]), { smoothFactor: 0, color: chosen ? sector.color : '#64748b', weight: chosen ? 4 : 2, opacity: chosen ? 0.95 : 0.35, interactive: false }).addTo(this.routes);
      }
      if (!chosen) continue;
      points.forEach((point, i) => {
        const airport = /^[A-Z]{4}$/.test(point.aipId ?? '');
        L.circleMarker([point.lat, point.lon], { radius: airport ? 7 : 4, color: '#fff', fillColor: airport ? '#162f49' : '#2563eb', fillOpacity: 1, weight: 2 })
          .bindTooltip(`${i + 1}. ${escapeHtml(point.name)}`).addTo(this.routes);
      });
    }
    const chosen = candidates.find(c => c.id === selected);
    this.terrainBadge.hidden = !chosen;
    this.terrainBadge.textContent = chosen ? terrainResolutionLabel(chosen.searchTerrain) : '';
    if (chosen) for (const issue of issues.filter(i => i.startNm !== undefined && i.endNm !== undefined).reverse()) {
      const points = issueRouteCoordinates(issue, chosen.legs);
      if (!points.length) continue;
      L.polyline(points.map(p => [p.lat, p.lon] as [number, number]), { color: issue.severity === 'conflict' ? '#dc2626' : '#b45309', weight: 8, opacity: 0.55, interactive: false }).addTo(this.routes);
    }
    if (chosen) this.map.fitBounds(L.latLngBounds(chosen.draft.waypoints.map(p => [p.lat, p.lon] as [number, number])), { padding: [35, 35], maxZoom: 10 });
    this.map.invalidateSize();
  }
  focusIssue(candidate: RouteCandidate, issue: RouteIssue): void {
    const points = issueRouteCoordinates(issue, candidate.legs); if (!points.length) return;
    this.notice.clearLayers();
    const color = issue.severity === 'conflict' ? '#dc2626' : '#b45309';
    L.polyline(points.map(p => [p.lat, p.lon] as [number, number]), { color, weight: 10, opacity: 0.85 }).addTo(this.notice);
    this.map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number])), { padding: [70, 70], maxZoom: 12 });
    L.popup().setLatLng([points[0].lat, points[0].lon]).setContent(`<strong>${escapeHtml(issueSeverityLabel(issue.severity))}: ${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.action)}</p>`).openOn(this.map);
    this.map.getContainer().scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }
}
