import L, {
  type Coords,
  type DoneCallback,
  type GridLayerOptions,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type Marker,
  type Point,
  type Polyline,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, Waypoint } from '../types';
import {
  ICAO_TILE_CSS_PX,
  vfrTilePixels,
  type ChartDetailMode,
} from './icaoQuality';

export interface MapManagerCallbacks {
  onMapClick(lat: number, lon: number): void;
  onWaypointMoved(id: string, lat: number, lon: number): void;
  onRouteLegInsert(legIndex: number, lat: number, lon: number): void;
}

export interface VerticalProfileMapMarker {
  id: string;
  type: 'TOC' | 'TOD';
  coordinate: Coordinate;
  title: string;
}

export type { ChartDetailMode } from './icaoQuality';

const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const AVINOR_ICAO_SERVICE =
  'https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer';
const AVINOR_ICAO_EXPORT = `${AVINOR_ICAO_SERVICE}/export`;
const AVINOR_ICAO_LAYERS = `${AVINOR_ICAO_SERVICE}/layers`;

class AvinorIcaoLayer extends L.GridLayer {
  private detailMode: ChartDetailMode = 'auto';

  constructor(options?: GridLayerOptions) {
    super({
      tileSize: ICAO_TILE_CSS_PX,
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

interface RouteInsertDrag {
  legIndex: number;
  startPoint: Point;
  latlng: L.LatLng;
  moved: boolean;
  mapDraggingWasEnabled: boolean;
}

export class MapManager {
  private readonly map: LeafletMap;
  private readonly markers = new Map<string, Marker>();
  private readonly verticalMarkers = new Map<string, Marker>();
  private readonly resizeObserver?: ResizeObserver;
  private readonly icaoLayer: AvinorIcaoLayer;
  private readonly routeLine: Polyline;
  private readonly routeHitLine: Polyline;
  private chartEdition: string | null = null;
  private renderedWaypoints: Waypoint[] = [];
  private routeInsertDrag: RouteInsertDrag | null = null;
  private suppressNextMapClick = false;

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
      interactive: false,
    }).addTo(this.map);

    this.routeHitLine = L.polyline([], {
      color: '#2563eb',
      weight: 18,
      opacity: 0.001,
      interactive: true,
    }).addTo(this.map);

    this.routeHitLine.on('mousedown', (event: LeafletMouseEvent) => {
      this.startRouteInsertDrag(event);
    });
    this.map.on('mousemove', (event: LeafletMouseEvent) => this.updateRouteInsertDrag(event));
    this.map.on('mouseup', (event: LeafletMouseEvent) => this.finishRouteInsertDrag(event, callbacks));

    this.map.on('click', (event) => {
      if (this.suppressNextMapClick) {
        this.suppressNextMapClick = false;
        return;
      }
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
    this.renderedWaypoints = waypoints.map((waypoint) => ({ ...waypoint }));
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

    const routeLatLngs = waypoints.map((waypoint) => L.latLng(waypoint.lat, waypoint.lon));
    if (!this.routeInsertDrag) this.routeLine.setLatLngs(routeLatLngs);
    this.routeHitLine.setLatLngs(routeLatLngs);
    this.routeHitLine.unbindTooltip();
    if (waypoints.length > 1) {
      this.routeHitLine.bindTooltip('Drag the route line to insert a waypoint', {
        sticky: true,
        direction: 'top',
      });
      const element = this.routeHitLine.getElement();
      if (element) element.style.cursor = 'grab';
    }
  }

  renderVerticalProfileMarkers(markers: VerticalProfileMapMarker[]): void {
    const activeIds = new Set(markers.map((marker) => marker.id));
    for (const [id, marker] of this.verticalMarkers) {
      if (!activeIds.has(id)) {
        marker.remove();
        this.verticalMarkers.delete(id);
      }
    }

    for (const item of markers) {
      let marker = this.verticalMarkers.get(item.id);
      const role = item.type.toLowerCase() as 'toc' | 'tod';
      if (!marker) {
        marker = L.marker([item.coordinate.lat, item.coordinate.lon], {
          keyboard: false,
          interactive: false,
          zIndexOffset: 700,
          icon: this.verticalProfileIcon(item.type, role),
        }).addTo(this.map);
        this.verticalMarkers.set(item.id, marker);
      }
      marker.setLatLng([item.coordinate.lat, item.coordinate.lon]);
      marker.setIcon(this.verticalProfileIcon(item.type, role));
      marker.unbindTooltip();
      marker.bindTooltip(item.title, { direction: 'top', offset: [0, -10] });
    }
  }

  private startRouteInsertDrag(event: LeafletMouseEvent): void {
    if (this.renderedWaypoints.length < 2) return;
    const mouseEvent = event.originalEvent as MouseEvent;
    if (typeof mouseEvent.button === 'number' && mouseEvent.button !== 0) return;

    const legIndex = this.closestLegIndex(event.latlng);
    if (legIndex < 0) return;

    const mapDraggingWasEnabled = this.map.dragging.enabled();
    if (mapDraggingWasEnabled) this.map.dragging.disable();
    this.routeInsertDrag = {
      legIndex,
      startPoint: this.map.latLngToContainerPoint(event.latlng),
      latlng: event.latlng,
      moved: false,
      mapDraggingWasEnabled,
    };
    const element = this.routeHitLine.getElement();
    if (element) element.style.cursor = 'grabbing';
    L.DomEvent.stop(event.originalEvent);
  }

  private updateRouteInsertDrag(event: LeafletMouseEvent): void {
    const drag = this.routeInsertDrag;
    if (!drag) return;

    drag.latlng = event.latlng;
    if (this.map.latLngToContainerPoint(event.latlng).distanceTo(drag.startPoint) >= 4) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    const preview = this.renderedWaypoints.map((waypoint) => L.latLng(waypoint.lat, waypoint.lon));
    preview.splice(drag.legIndex + 1, 0, event.latlng);
    this.routeLine.setLatLngs(preview);
  }

  private finishRouteInsertDrag(event: LeafletMouseEvent, callbacks: MapManagerCallbacks): void {
    const drag = this.routeInsertDrag;
    if (!drag) return;
    this.routeInsertDrag = null;

    if (drag.mapDraggingWasEnabled) this.map.dragging.enable();
    const element = this.routeHitLine.getElement();
    if (element) element.style.cursor = 'grab';

    this.suppressNextMapClick = true;
    window.setTimeout(() => {
      this.suppressNextMapClick = false;
    }, 0);

    if (drag.moved) {
      callbacks.onRouteLegInsert(drag.legIndex, event.latlng.lat, event.latlng.lng);
    } else {
      this.routeLine.setLatLngs(
        this.renderedWaypoints.map((waypoint) => L.latLng(waypoint.lat, waypoint.lon)),
      );
    }
    L.DomEvent.stop(event.originalEvent);
  }

  private closestLegIndex(latlng: L.LatLng): number {
    if (this.renderedWaypoints.length < 2) return -1;
    const target = this.map.latLngToContainerPoint(latlng);
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.renderedWaypoints.length - 1; index += 1) {
      const from = this.renderedWaypoints[index];
      const to = this.renderedWaypoints[index + 1];
      const start = this.map.latLngToContainerPoint([from.lat, from.lon]);
      const end = this.map.latLngToContainerPoint([to.lat, to.lon]);
      const distance = squaredDistanceToSegment(target, start, end);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    }

    return closestIndex;
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

  private verticalProfileIcon(label: string, role: 'toc' | 'tod'): L.DivIcon {
    return L.divIcon({
      className: 'vertical-map-icon-shell',
      html: `<span class="vertical-map-icon vertical-map-icon--${role}">${label}</span>`,
      iconSize: [46, 26],
      iconAnchor: [23, 13],
    });
  }
}

function squaredDistanceToSegment(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  const projection = ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, projection));
  const closestX = start.x + t * dx;
  const closestY = start.y + t * dy;
  const px = point.x - closestX;
  const py = point.y - closestY;
  return px * px + py * py;
}
