import L, {
  type Coords,
  type DoneCallback,
  type GridLayerOptions,
  type Map as LeafletMap,
  type Marker,
  type Polyline,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Waypoint } from '../types';

export interface MapManagerCallbacks {
  onMapClick(lat: number, lon: number): void;
  onWaypointMoved(id: string, lat: number, lon: number): void;
}

const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const AVINOR_ICAO_EXPORT =
  'https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer/export';

class AvinorIcaoLayer extends L.GridLayer {
  constructor(options?: GridLayerOptions) {
    super({ tileSize: 256, maxZoom: 13, minZoom: 4, ...options });
  }

  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.setAttribute('role', 'presentation');

    const tileSize = 256;
    const tilesAtZoom = 2 ** coords.z;
    const span = (WEB_MERCATOR_HALF_WORLD * 2) / tilesAtZoom;
    const minX = -WEB_MERCATOR_HALF_WORLD + coords.x * span;
    const maxX = minX + span;
    const maxY = WEB_MERCATOR_HALF_WORLD - coords.y * span;
    const minY = maxY - span;

    const params = new URLSearchParams({
      bbox: `${minX},${minY},${maxX},${maxY}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${tileSize},${tileSize}`,
      format: 'png32',
      transparent: 'false',
      f: 'image',
    });

    tile.onload = () => done(undefined, tile);
    tile.onerror = () => done(new Error('Failed to load Avinor ICAO chart tile.'), tile);
    tile.src = `${AVINOR_ICAO_EXPORT}?${params.toString()}`;
    return tile;
  }
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

    const kartverket = L.tileLayer(
      'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
      {
        maxZoom: 19,
        attribution: '&copy; Kartverket',
      },
    );

    const icao = new AvinorIcaoLayer({
      attribution: 'Norway Aeronautical Chart ICAO 1:500 000 &copy; Avinor',
    });

    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    });

    kartverket.addTo(this.map);
    L.control
      .layers(
        {
          'Norgeskart · Kartverket': kartverket,
          'ICAO 1:500 000 · Avinor': icao,
          'OpenStreetMap · fallback': openStreetMap,
        },
        undefined,
        { collapsed: false, position: 'topright' },
      )
      .addTo(this.map);

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
      const role = index === 0 ? 'departure' : index === waypoints.length - 1 ? 'destination' : 'enroute';

      if (!marker) {
        marker = L.marker([waypoint.lat, waypoint.lon], {
          draggable: true,
          keyboard: true,
          title: waypoint.name,
          icon: this.waypointIcon(index + 1, role),
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
      marker.setIcon(this.waypointIcon(index + 1, role));
      marker.bindTooltip(`${index + 1}. ${waypoint.name}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -17],
        className: 'route-label',
      });
    });

    this.routeLine.setLatLngs(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));

    if (waypoints.length > 1) {
      const bounds = L.latLngBounds(waypoints.map((waypoint) => [waypoint.lat, waypoint.lon]));
      this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 10 });
    }
  }

  private waypointIcon(index: number, role: 'departure' | 'destination' | 'enroute'): L.DivIcon {
    return L.divIcon({
      className: 'waypoint-icon-shell',
      html: `<span class="waypoint-map-icon waypoint-map-icon--${role}" data-number="${index}"></span>`,
      iconSize: [28, 34],
      iconAnchor: [14, 30],
      tooltipAnchor: [0, -4],
    });
  }
}
