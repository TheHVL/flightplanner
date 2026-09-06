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

export type ChartDetailMode = 'auto' | 'sharp' | 'fast';

const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const WEB_MERCATOR_INITIAL_RESOLUTION = 156543.03392804097;
const VFR_SOURCE_RESOLUTION_M_PER_PX = 31.75;
const TILE_CSS_PX = 256;
const AVINOR_ICAO_SERVICE =
  'https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer';
const AVINOR_ICAO_EXPORT = `${AVINOR_ICAO_SERVICE}/export`;
const AVINOR_ICAO_LAYERS = `${AVINOR_ICAO_SERVICE}/layers`;

export function webMercatorTileCentreLatitudeDeg(z: number, y: number): number {
  const n = Math.PI - (2 * Math.PI * (y + 0.5)) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

export function chartDetailRatioCap(z: number, mode: ChartDetailMode): number {
  if (mode === 'sharp') return 4;
  if (mode === 'fast') return 1;
  return z <= 9 ? 2 : 4;
}

export function vfrPixelRatio(
  z: number,
  y: number,
  devicePixelRatio = 1,
  mode: ChartDetailMode = 'auto',
): number {
  const latitudeRad = (webMercatorTileCentreLatitudeDeg(z, y) * Math.PI) / 180;
  const cssResolutionMPerPx =
    (WEB_MERCATOR_INITIAL_RESOLUTION * Math.cos(latitudeRad)) / 2 ** z;
  const sourceMatchRatio = cssResolutionMPerPx / VFR_SOURCE_RESOLUTION_M_PER_PX;
  const wantedRatio = Math.min(sourceMatchRatio, chartDetailRatioCap(z, mode));

  return Math.min(4, Math.max(1, devicePixelRatio > 0 ? devicePixelRatio : 1, wantedRatio));
}

export function vfrTilePixels(
  z: number,
  y: number,
  devicePixelRatio = 1,
  mode: ChartDetailMode = 'auto',
): number {
  const requested = TILE_CSS_PX * vfrPixelRatio(z, y, devicePixelRatio, mode);
  return Math.ceil(requested / 8) * 8;
}

class AvinorIcaoLayer extends L.GridLayer {
  private detailMode: ChartDetailMode = 'auto';

  constructor(options?: GridLayerOptions) {
    super({
      tileSize: TILE_CSS_PX,
      maxZoom: 18,
      maxNativeZoom: 11,
      minZoom: 4,
      noWrap: true,
      keepBuffer: 4,
      updateWhenIdle: true,
      updateWhenZooming: false,
      ...options,
    });
  }

  setDetailMode(mode: ChartDetailMode): void {
    if (this.detailMode === mode) return;
    this.detailMode = mode;
    this.redraw();
  }

  createTile(coords: Coords, done: DoneCallback): HTMLElement {
    const tile = document.createElement('img');
    tile.alt = '';
    tile.decoding = 'async';
    tile.setAttribute('role', 'presentation');

    const tilesAtZoom = 2 ** coords.z;
    const span = (WEB_MERCATOR_HALF_WORLD * 2) / tilesAtZoom;
    const minX = -WEB_MERCATOR_HALF_WORLD + coords.x * span;
    const maxX = minX + span;
    const maxY = WEB_MERCATOR_HALF_WORLD - coords.y * span;
    const minY = maxY - span;
    const rasterPixels = vfrTilePixels(
      coords.z,
      coords.y,
      window.devicePixelRatio || 1,
      this.detailMode,
    );

    const params = new URLSearchParams({
      bbox: `${minX},${minY},${maxX},${maxY}`,
      bboxSR: '3857',
      imageSR: '3857',
      size: `${rasterPixels},${rasterPixels}`,
      format: 'png24',
      dpi: '96',
      transparent: 'false',
      f: 'image',
    });

    tile.onload = () => done(undefined, tile);
    tile.onerror = () => done(new Error('Failed to load Avinor ICAO chart tile.'), tile);
    tile.src = `${AVINOR_ICAO_EXPORT}?${params.toString()}`;
    return tile;
  }
}

interface ArcGisLayerMetadata {
  layers?: Array<{ name?: string }>;
}

export class MapManager {
  private readonly map: LeafletMap;
  private readonly markers = new Map<string, Marker>();
  private readonly resizeObserver?: ResizeObserver;
  private readonly icaoLayer: AvinorIcaoLayer;
  private routeLine: Polyline;
  private chartEdition: string | null = null;

  constructor(element: HTMLElement, callbacks: MapManagerCallbacks) {
    this.map = L.map(element, {
      zoomControl: true,
      attributionControl: true,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1,
      worldCopyJump: false,
    }).setView([69.6492, 18.9553], 7);

    const kartverket = L.tileLayer(
      'https://cache.kartverket.no/v1/wmts/1.0.0/topo/default/webmercator/{z}/{y}/{x}.png',
      {
        maxZoom: 19,
        noWrap: true,
        keepBuffer: 4,
        attribution: '&copy; Kartverket',
      },
    );

    this.icaoLayer = new AvinorIcaoLayer({
      attribution: 'Norway Aeronautical Chart ICAO 1:500 000 &copy; Avinor',
    });

    const openStreetMap = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      noWrap: true,
      keepBuffer: 4,
      attribution: '&copy; OpenStreetMap contributors',
    });

    kartverket.addTo(this.map);
    L.control
      .layers(
        {
          'Norgeskart · Kartverket': kartverket,
          'ICAO 1:500 000 · Avinor': this.icaoLayer,
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

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.invalidateSize());
      this.resizeObserver.observe(element);
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => this.reportChartEdition());
    }
    this.requestChartEdition();

    window.setTimeout(() => this.invalidateSize(), 0);
  }

  invalidateSize(): void {
    this.map.invalidateSize({ pan: false, animate: false });
  }

  setChartDetail(mode: ChartDetailMode): void {
    this.icaoLayer.setDetailMode(mode);
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

  private requestChartEdition(): void {
    const callbackName = `__flightplannerIcaoEdition_${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
    const script = document.createElement('script');
    const globalWindow = window as unknown as Record<string, unknown>;

    const cleanup = () => {
      delete globalWindow[callbackName];
      script.remove();
    };

    globalWindow[callbackName] = (metadata: ArcGisLayerMetadata) => {
      const edition = metadata.layers?.[0]?.name?.trim();
      if (edition) {
        this.chartEdition = edition;
        this.reportChartEdition();
      }
      cleanup();
    };

    script.src = `${AVINOR_ICAO_LAYERS}?f=json&callback=${encodeURIComponent(callbackName)}`;
    script.onerror = cleanup;
    document.head.appendChild(script);
  }

  private reportChartEdition(): void {
    if (!this.chartEdition || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.controller?.postMessage({
      type: 'chart-edition',
      edition: this.chartEdition,
    });
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
