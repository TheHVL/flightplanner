import L, { type GridLayer, type Map as LeafletMap, type Marker, type Polyline, type TileLayer } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Waypoint } from '../types';
import { ArcGisExportLayer } from './ArcGisExportLayer';

export type BaseMapId = 'norgeskart' | 'icao500';

export interface MapManagerCallbacks {
  onMapClick(lat: number, lon: number): void;
  onWaypointMoved(id: string, lat: number, lon: number): void;
}

export class MapManager {
  private readonly map: LeafletMap;
  private readonly norgeskartLayer: TileLayer;
  private readonly icaoLayer: GridLayer | null;
  private readonly markers = new Map<string, Marker>();
  private routeLine: Polyline;
  private baseMap: BaseMapId = 'norgeskart';
  private overlayMode = false;
  private icaoOpacity = 0.75;

  constructor(element: HTMLElement, callbacks: MapManagerCallbacks) {
    this.map = L.map(element, {
      zoomControl: true,
      attributionControl: true,
    }).setView([69.6492, 18.9553], 7);

    this.map.createPane('aviation');
    const aviationPane = this.map.getPane('aviation');
    if (aviationPane) aviationPane.style.zIndex = '250';

    this.map.createPane('flightplan');
    const flightplanPane = this.map.getPane('flightplan');
    if (flightplanPane) flightplanPane.style.zIndex = '450';

    this.norgeskartLayer = L.tileLayer(
      'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
      {
        maxZoom: 20,
        attribution: '© Kartverket',
      },
    ).addTo(this.map);

    const icaoExportUrl = import.meta.env.VITE_AVINOR_ICAO_EXPORT_URL?.trim();
    this.icaoLayer = icaoExportUrl
      ? new ArcGisExportLayer({
          exportUrl: icaoExportUrl,
          visibleLayerIds: [3],
          pane: 'aviation',
          opacity: this.icaoOpacity,
          attribution: '© Avinor',
          maxZoom: 12,
        })
      : null;

    this.routeLine = L.polyline([], {
      color: '#2563eb',
      weight: 4,
      opacity: 0.9,
      pane: 'flightplan',
    }).addTo(this.map);

    this.map.on('click', (event) => {
      callbacks.onMapClick(event.latlng.lat, event.latlng.lng);
    });

    window.setTimeout(() => this.map.invalidateSize(), 0);
  }

  isIcaoAvailable(): boolean {
    return this.icaoLayer !== null;
  }

  setBaseMap(baseMap: BaseMapId): void {
    if (baseMap === 'icao500' && !this.icaoLayer) return;
    this.baseMap = baseMap;
    this.overlayMode = false;
    this.syncMapLayers();
  }

  setIcaoOverlay(enabled: boolean): void {
    if (!this.icaoLayer) return;
    this.overlayMode = enabled;
    if (enabled) this.baseMap = 'norgeskart';
    this.syncMapLayers();
  }

  setIcaoOpacity(opacity: number): void {
    this.icaoOpacity = Math.min(1, Math.max(0, opacity));
    this.icaoLayer?.setOpacity(this.icaoOpacity);
  }

  getLayerState(): { baseMap: BaseMapId; overlayMode: boolean; icaoOpacity: number; icaoAvailable: boolean } {
    return {
      baseMap: this.baseMap,
      overlayMode: this.overlayMode,
      icaoOpacity: this.icaoOpacity,
      icaoAvailable: this.isIcaoAvailable(),
    };
  }

  renderRoute(waypoints: Waypoint[], onMoved: MapManagerCallbacks['onWaypointMoved']): void {
    const activeIds = new Set(waypoints.map((waypoint) => waypoint.id));

    for (const [id, marker] of this.markers) {
      if (!activeIds.has(id)) {
        marker.remove();
        this.markers.delete(id);
      }
    }

    waypoints.forEach((waypoint, index) => {
      let marker = this.markers.get(waypoint.id);

      if (!marker) {
        marker = L.marker([waypoint.lat, waypoint.lon], {
          draggable: true,
          keyboard: true,
          title: waypoint.name,
          pane: 'flightplan',
        }).addTo(this.map);

        marker.on('dragend', () => {
          const position = marker?.getLatLng();
          if (position) onMoved(waypoint.id, position.lat, position.lng);
        });

        this.markers.set(waypoint.id, marker);
      }

      marker.setLatLng([waypoint.lat, waypoint.lon]);
      marker.bindTooltip(`${index + 1}. ${waypoint.name}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -10],
        className: 'route-label',
        pane: 'flightplan',
      });
    });

    this.routeLine.setLatLngs(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));

    if (waypoints.length > 1) {
      const bounds = L.latLngBounds(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));
      this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 10 });
    }
  }

  private syncMapLayers(): void {
    const shouldShowNorgeskart = this.baseMap === 'norgeskart' || this.overlayMode;
    const shouldShowIcao = this.baseMap === 'icao500' || this.overlayMode;

    if (shouldShowNorgeskart && !this.map.hasLayer(this.norgeskartLayer)) this.norgeskartLayer.addTo(this.map);
    if (!shouldShowNorgeskart && this.map.hasLayer(this.norgeskartLayer)) this.norgeskartLayer.remove();

    if (this.icaoLayer) {
      this.icaoLayer.setOpacity(this.icaoOpacity);
      if (shouldShowIcao && !this.map.hasLayer(this.icaoLayer)) this.icaoLayer.addTo(this.map);
      if (!shouldShowIcao && this.map.hasLayer(this.icaoLayer)) this.icaoLayer.remove();
    }

    this.routeLine.bringToFront();
    this.markers.forEach((marker) => marker.setZIndexOffset(1000));
  }
}
