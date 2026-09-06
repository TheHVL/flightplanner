import L, { type Map as LeafletMap, type Marker, type Polyline } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Waypoint } from '../types';

export interface MapManagerCallbacks {
  onMapClick(lat: number, lon: number): void;
  onWaypointMoved(id: string, lat: number, lon: number): void;
}

export class MapManager {
  private readonly map: LeafletMap;
  private readonly markers = new Map<string, Marker>();
  private routeLine: Polyline;

  constructor(element: HTMLElement, callbacks: MapManagerCallbacks) {
    this.map = L.map(element, {
      zoomControl: true,
      attributionControl: true,
    }).setView([69.6492, 18.9553], 7);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(this.map);

    this.routeLine = L.polyline([], {
      color: '#2563eb',
      weight: 4,
      opacity: 0.9,
    }).addTo(this.map);

    this.map.on('click', (event) => {
      callbacks.onMapClick(event.latlng.lat, event.latlng.lng);
    });

    window.setTimeout(() => this.map.invalidateSize(), 0);
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
        }).addTo(this.map);

        marker.on('dragend', () => {
          const position = marker?.getLatLng();
          if (position) {
            onMoved(waypoint.id, position.lat, position.lng);
          }
        });

        this.markers.set(waypoint.id, marker);
      }

      marker.setLatLng([waypoint.lat, waypoint.lon]);
      marker.bindTooltip(`${index + 1}. ${waypoint.name}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -10],
        className: 'route-label',
      });
    });

    this.routeLine.setLatLngs(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));

    if (waypoints.length > 1) {
      const bounds = L.latLngBounds(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));
      this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 10 });
    }
  }
}
