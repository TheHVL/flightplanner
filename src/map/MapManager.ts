import { escapeHtml } from '../utils/html';
import { nearestPublishedPoint, type PublishedMapPoint } from '../aip/mapPoints';
import L, {
  type Coords,
  type DoneCallback,
  type GridLayerOptions,
  type LayerGroup,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type Marker,
  type Point,
  type Polyline,
} from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Coordinate, RouteLeg, Waypoint } from '../types';
import { densifyRoutePath, routeLegPath } from '../navigation/geodesy';
import { issueRouteCoordinates, issueSeverityLabel, type RouteIssue } from '../routing/issues';
import {
  buildLegCorridorPolygon,
  destinationCoordinate,
  MSA_CORRIDOR_HALF_WIDTH_METERS,
} from '../navigation/msaCorridor';
import {
  ICAO_TILE_CSS_PX,
  vfrTilePixels,
  type ChartDetailMode,
} from './icaoQuality';

export interface MapManagerCallbacks {
  onLegSelected?(index: number): void;
  onWaypointSelected?(id: string): void;
  onMapClick(lat: number, lon: number, publishedPoint?: PublishedMapPoint): void;
  onWaypointMoved(id: string, lat: number, lon: number, publishedPoint?: PublishedMapPoint): void;
  onRouteLegShape(legIndex: number, lat: number, lon: number): void;
}

export interface VerticalProfileMapMarker {
  id: string;
  type: 'TOC' | 'TOD';
  coordinate: Coordinate;
  /** Local plotted route track. The marker is drawn perpendicular to it. */
  trueTrackDeg: number;
  title: string;
}

export interface VerticalConflictMapSegment {
  id: string;
  coordinates: Coordinate[];
  title: string;
}

export interface GlideEnvelopeMapSample {
  lat: number;
  lon: number;
  glideRangeNm: number;
}

export interface GlideCoastlineMapSegment {
  severity: 'marginal' | 'unreachable';
  from: Coordinate;
  to: Coordinate;
}

export type { ChartDetailMode } from './icaoQuality';

const WEB_MERCATOR_HALF_WORLD = 20037508.342789244;
const AVINOR_ICAO_SERVICE =
  'https://avigis.avinor.no/agsmap/rest/services/ICAO_500000_ExB/MapServer';
const AVINOR_ICAO_EXPORT = `${AVINOR_ICAO_SERVICE}/export`;
const AVINOR_ICAO_LAYERS = `${AVINOR_ICAO_SERVICE}/layers`;
const VERTICAL_MARKER_HALF_WIDTH_NM = 0.22;

export class AvinorIcaoLayer extends L.GridLayer {
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

interface RouteShapeDrag {
  legIndex: number;
  startPoint: Point;
  latlng: L.LatLng;
  moved: boolean;
  mapDraggingWasEnabled: boolean;
}

interface ArcGisLayerMetadata {
  layers?: Array<{ name?: string }>;
}

export class MapManager {
  private readonly map: LeafletMap;
  private readonly markers = new Map<string, Marker>();
  private readonly publishedPointLayer: LayerGroup;
  private publishedPoints: PublishedMapPoint[] = [];
  private snapEnabled = true;
  private readonly publishedPointSelected: (point: PublishedMapPoint) => void;
  private readonly resizeObserver?: ResizeObserver;
  private readonly icaoLayer: AvinorIcaoLayer;
  private readonly routeLine: Polyline;
  private readonly routeHitLine: Polyline;
  private readonly selectedLegLine: Polyline;
  private readonly verticalProfileLayer: LayerGroup;
  private readonly verticalConflictLayer: LayerGroup;
  private readonly routeIssueLayer: LayerGroup;
  private readonly msaCorridorLayer: LayerGroup;
  private readonly glideEnvelopeLayer: LayerGroup;
  private readonly glideCoastlineLayer: LayerGroup;
  private chartEdition: string | null = null;
  private renderedWaypoints: Waypoint[] = [];
  private renderedLegs: RouteLeg[] = [];
  private routeShapeDrag: RouteShapeDrag | null = null;
  private suppressNextMapClick = false;
  private msaCorridorVisible = false;
  private glideEnvelopeVisible = false;

  private readonly waypointSelected: (id: string) => void;
  constructor(element: HTMLElement, callbacks: MapManagerCallbacks) {
    this.waypointSelected = id => callbacks.onWaypointSelected?.(id);
    this.publishedPointSelected = point => callbacks.onMapClick(point.lat, point.lon, point);
    this.map = L.map(element, {
      zoomControl: true,
      attributionControl: true,
      maxBounds: [[-90, -180], [90, 180]],
      maxBoundsViscosity: 1,
      worldCopyJump: false,
    }).setView([69.6492, 18.9553], 7);
    this.publishedPointLayer = L.layerGroup().addTo(this.map);
    this.map.on('moveend zoomend', () => this.renderPublishedPoints());

    const glidePane = this.map.createPane('glide-envelope-pane');
    glidePane.style.zIndex = '385';
    glidePane.style.pointerEvents = 'none';
    this.glideEnvelopeLayer = L.layerGroup();

    const glideCoastlinePane = this.map.createPane('glide-coastline-pane');
    glideCoastlinePane.style.zIndex = '605';
    glideCoastlinePane.style.pointerEvents = 'none';
    this.glideCoastlineLayer = L.layerGroup();

    const msaPane = this.map.createPane('msa-corridor-pane');
    msaPane.style.zIndex = '390';
    msaPane.style.pointerEvents = 'none';
    this.msaCorridorLayer = L.layerGroup();

    const conflictPane = this.map.createPane('vertical-conflict-pane');
    conflictPane.style.zIndex = '610';
    conflictPane.style.pointerEvents = 'none';
    this.verticalConflictLayer = L.layerGroup().addTo(this.map);
    this.routeIssueLayer = L.layerGroup().addTo(this.map);

    const verticalPane = this.map.createPane('vertical-profile-pane');
    verticalPane.style.zIndex = '620';
    verticalPane.style.pointerEvents = 'none';
    this.verticalProfileLayer = L.layerGroup().addTo(this.map);

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
      smoothFactor: 0,
      color: '#2563eb',
      weight: 4,
      opacity: 0.9,
      interactive: false,
    }).addTo(this.map);

    this.selectedLegLine = L.polyline([], { smoothFactor: 0, color: '#e6a325', weight: 7, opacity: 0.85, interactive: false }).addTo(this.map);
    this.routeHitLine = L.polyline([], {
      smoothFactor: 0,
      color: '#2563eb',
      weight: 18,
      opacity: 0.001,
      interactive: true,
    }).addTo(this.map);

    this.routeHitLine.on('click', (event: LeafletMouseEvent) => {
      L.DomEvent.stop(event.originalEvent);
      if (this.suppressNextMapClick) return;
      const index = this.closestLegIndex(event.latlng);
      if (index >= 0) callbacks.onLegSelected?.(index);
    });
    this.routeHitLine.on('mousedown', (event: LeafletMouseEvent) => {
      this.startRouteShapeDrag(event);
    });
    this.map.on('mousemove', (event: LeafletMouseEvent) => this.updateRouteShapeDrag(event));
    this.map.on('mouseup', (event: LeafletMouseEvent) => this.finishRouteShapeDrag(event, callbacks));

    this.map.on('click', (event) => {
      if (this.suppressNextMapClick) {
        this.suppressNextMapClick = false;
        return;
      }
      const point = this.snapPoint(event.latlng, event.originalEvent.altKey);
      callbacks.onMapClick(point?.lat ?? event.latlng.lat, point?.lon ?? event.latlng.lng, point);
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

  setSelectedLeg(selection: {fromId: string; toId: string}): void {
    const leg = this.renderedLegs.find(l => l.from.id === selection.fromId && l.to.id === selection.toId);
    this.selectedLegLine.setLatLngs(leg ? densifyRoutePath(routeLegPath(leg)).map(p => [p.lat, p.lon] as [number, number]) : []);
  }

  setPublishedPoints(points: PublishedMapPoint[]): void {
    this.publishedPoints = points;
    this.renderPublishedPoints();
  }

  setSnapEnabled(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.renderPublishedPoints();
  }

  private snapPoint(latlng: L.LatLng, bypass = false): PublishedMapPoint | undefined {
    if (!this.snapEnabled || bypass) return undefined;
    return nearestPublishedPoint({ lat: latlng.lat, lon: latlng.lng }, this.publishedPoints,
      p => this.map.latLngToContainerPoint([p.lat, p.lon]));
  }

  private renderPublishedPoints(): void {
    this.publishedPointLayer.clearLayers();
    if (!this.snapEnabled) return;
    const zoom = this.map.getZoom(), bounds = this.map.getBounds();
    for (const point of this.publishedPoints) {
      if (zoom < (point.kind === 'airport' ? 7 : 9) || !bounds.contains([point.lat, point.lon])) continue;
      const airport = point.kind === 'airport';
      const label = airport ? `${point.name} airport` : `${point.name} reporting point (${point.aerodromeIcao})`;
      const marker = L.marker([point.lat, point.lon], {
        keyboard: true, title: label, alt: label,
        icon: L.divIcon({ className: `aip-map-point aip-map-point--${point.kind}`, html: airport ? '<span>A</span>' : '<span>◆</span>', iconSize: [18,18], iconAnchor: [9,9] }),
        zIndexOffset: -500,
      }).addTo(this.publishedPointLayer);
      marker.getElement()?.setAttribute('aria-label', label);
      marker.on('click', event => { L.DomEvent.stop(event.originalEvent); this.publishedPointSelected(point); });
    }
  }

  invalidateSize(): void {
    this.map.invalidateSize({ pan: false, animate: false });
  }

  setChartDetail(mode: ChartDetailMode): void {
    this.icaoLayer.setDetailMode(mode);
  }

  setMsaCorridorVisible(visible: boolean): void {
    if (this.msaCorridorVisible === visible) return;
    this.msaCorridorVisible = visible;
    if (visible) this.msaCorridorLayer.addTo(this.map);
    else this.msaCorridorLayer.removeFrom(this.map);
  }

  setGlideEnvelopeVisible(visible: boolean): void {
    if (this.glideEnvelopeVisible === visible) return;
    this.glideEnvelopeVisible = visible;
    if (visible) {
      this.glideEnvelopeLayer.addTo(this.map);
      this.glideCoastlineLayer.addTo(this.map);
    } else {
      this.glideEnvelopeLayer.removeFrom(this.map);
      this.glideCoastlineLayer.removeFrom(this.map);
    }
  }

  renderMsaCorridor(legs: RouteLeg[]): void {
    this.msaCorridorLayer.clearLayers();
    if (legs.length === 0) return;

    const pathStyle = {
      pane: 'msa-corridor-pane',
      smoothFactor: 0,
      color: '#c46a12',
      weight: 1.2,
      opacity: 0.72,
      fillColor: '#f2a23a',
      fillOpacity: 0.11,
      interactive: false,
    } as const;

    for (const leg of legs) {
      const path = routeLegPath(leg);
      for (let index = 0; index < path.length - 1; index += 1) {
        const polygon = buildLegCorridorPolygon(path[index], path[index + 1]);
        L.polygon(
          polygon.map((point) => [point.lat, point.lon] as [number, number]),
          pathStyle,
        ).addTo(this.msaCorridorLayer);
      }

      for (const point of path) {
        const cap = Array.from({ length: 72 }, (_, i) =>
          destinationCoordinate(point, i * 5, MSA_CORRIDOR_HALF_WIDTH_METERS / 1852));
        L.polygon(cap.map(p => [p.lat, p.lon] as [number, number]), pathStyle).addTo(this.msaCorridorLayer);
      }
    }
  }

  renderGlideEnvelope(samples: GlideEnvelopeMapSample[]): void {
    this.glideEnvelopeLayer.clearLayers();
    for (const sample of samples) {
      if (!Number.isFinite(sample.glideRangeNm) || sample.glideRangeNm <= 0) continue;
      L.circle([sample.lat, sample.lon], {
        pane: 'glide-envelope-pane',
        radius: sample.glideRangeNm * 1852,
        stroke: false,
        fill: true,
        fillColor: '#1467d9',
        fillOpacity: 0.065,
        interactive: false,
      }).addTo(this.glideEnvelopeLayer);
    }
  }

  renderGlideCoastlineSegments(segments: GlideCoastlineMapSegment[]): void {
    this.glideCoastlineLayer.clearLayers();
    for (const segment of segments) {
      const unreachable = segment.severity === 'unreachable';
      L.polyline(
        [
          [segment.from.lat, segment.from.lon],
          [segment.to.lat, segment.to.lon],
        ],
        {
          pane: 'glide-coastline-pane',
          color: unreachable ? '#c62828' : '#d97706',
          weight: unreachable ? 7 : 6,
          opacity: 0.92,
          dashArray: unreachable ? undefined : '8 6',
          lineCap: 'round',
          interactive: false,
        },
      ).addTo(this.glideCoastlineLayer);
    }
  }

  renderRoute(
    waypoints: Waypoint[],
    legs: RouteLeg[],
    onMoved: MapManagerCallbacks['onWaypointMoved'],
  ): void {
    this.renderedWaypoints = waypoints.map((waypoint) => ({ ...waypoint }));
    this.renderedLegs = legs.map((leg) => ({
      ...leg,
      from: { ...leg.from },
      to: { ...leg.to },
      path: routeLegPath(leg).map((point) => ({ ...point })),
    }));
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

        marker.on('click', event => { L.DomEvent.stop(event.originalEvent); this.waypointSelected(waypoint.id); });
        marker.on('dragend', () => {
          const position = marker?.getLatLng();
          if (position) {
            const point = this.snapPoint(position);
            onMoved(waypoint.id, point?.lat ?? position.lat, point?.lon ?? position.lng, point);
          }
        });

        this.markers.set(waypoint.id, marker);
      }

      marker.setLatLng([waypoint.lat, waypoint.lon]);
      marker.setIcon(this.waypointIcon(index + 1, role));
      marker.bindTooltip(`${index + 1}. ${escapeHtml(waypoint.name)}`, {
        permanent: true,
        direction: 'top',
        offset: [0, -17],
        className: 'route-label',
      });
    });

    const routeLatLngs = this.routePathLatLngs();
    if (!this.routeShapeDrag) this.routeLine.setLatLngs(routeLatLngs);
    this.routeHitLine.setLatLngs(routeLatLngs);
    this.routeHitLine.unbindTooltip();
    if (waypoints.length > 1) {
      this.routeHitLine.bindTooltip('Click to prepare this leg. Drag to shape the flown path.', {
        sticky: true,
        direction: 'top',
      });
      const element = this.routeHitLine.getElement();
      if (element) (element as SVGElement).style.cursor = 'grab';
    }
  }

  renderVerticalProfileConflicts(segments: VerticalConflictMapSegment[]): void {
    this.verticalConflictLayer.clearLayers();
    for (const segment of segments) {
      if (segment.coordinates.length < 2) continue;
      L.polyline(
        segment.coordinates.map((point) => [point.lat, point.lon] as [number, number]),
        {
          pane: 'vertical-conflict-pane',
          color: '#dc2626',
          weight: 10,
          opacity: 0.48,
          dashArray: '8 7',
          interactive: false,
        },
      ).addTo(this.verticalConflictLayer);
    }
  }
  renderRouteIssues(issues: RouteIssue[], legs: RouteLeg[]): void {
    this.routeIssueLayer.clearLayers();
    for (const issue of issues.filter(i => i.startNm !== undefined && i.endNm !== undefined).reverse()) {
      const points = issueRouteCoordinates(issue, legs); if (!points.length) continue;
      L.polyline(points.map(p => [p.lat, p.lon] as [number, number]), { color: issue.severity === 'conflict' ? '#dc2626' : '#b45309', weight: 8, opacity: 0.6, interactive: false }).addTo(this.routeIssueLayer);
    }
  }
  focusRouteIssue(issue: RouteIssue, legs: RouteLeg[]): void {
    const points = issueRouteCoordinates(issue, legs); if (!points.length) return;
    this.map.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lon] as [number, number])), { padding: [55, 55], maxZoom: 12 });
    L.popup().setLatLng([points[0].lat, points[0].lon]).setContent(`<strong>${escapeHtml(issueSeverityLabel(issue.severity))}: ${escapeHtml(issue.title)}</strong><p>${escapeHtml(issue.action)}</p>`).openOn(this.map);
    this.map.getContainer().scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
  }

  renderVerticalProfileMarkers(markers: VerticalProfileMapMarker[]): void {
    this.verticalProfileLayer.clearLayers();

    for (const item of markers) {
      const left = destinationCoordinate(item.coordinate, item.trueTrackDeg - 90, VERTICAL_MARKER_HALF_WIDTH_NM);
      const right = destinationCoordinate(item.coordinate, item.trueTrackDeg + 90, VERTICAL_MARKER_HALF_WIDTH_NM);
      const color = item.type === 'TOC' ? '#7048c8' : '#b45309';
      const line = L.polyline(
        [[left.lat, left.lon], [right.lat, right.lon]],
        {
          pane: 'vertical-profile-pane',
          color,
          weight: 4,
          opacity: 0.96,
          interactive: false,
        },
      ).addTo(this.verticalProfileLayer);
      line.bindTooltip(item.type, {
        permanent: true,
        direction: 'top',
        offset: [0, -3],
        className: `vertical-line-label vertical-line-label--${item.type.toLowerCase()}`,
      });
    }
  }

  private startRouteShapeDrag(event: LeafletMouseEvent): void {
    if (this.renderedLegs.length === 0) return;
    const mouseEvent = event.originalEvent as MouseEvent;
    if (typeof mouseEvent.button === 'number' && mouseEvent.button !== 0) return;

    const legIndex = this.closestLegIndex(event.latlng);
    if (legIndex < 0) return;

    const mapDraggingWasEnabled = this.map.dragging.enabled();
    if (mapDraggingWasEnabled) this.map.dragging.disable();
    this.routeShapeDrag = {
      legIndex,
      startPoint: this.map.latLngToContainerPoint(event.latlng),
      latlng: event.latlng,
      moved: false,
      mapDraggingWasEnabled,
    };
    const element = this.routeHitLine.getElement();
    if (element) (element as SVGElement).style.cursor = 'grabbing';
    L.DomEvent.stop(event.originalEvent);
  }

  private updateRouteShapeDrag(event: LeafletMouseEvent): void {
    const drag = this.routeShapeDrag;
    if (!drag) return;

    drag.latlng = event.latlng;
    if (this.map.latLngToContainerPoint(event.latlng).distanceTo(drag.startPoint) >= 4) {
      drag.moved = true;
    }
    if (!drag.moved) return;

    this.routeLine.setLatLngs(this.routePathLatLngs(drag.legIndex, event.latlng));
  }

  private finishRouteShapeDrag(event: LeafletMouseEvent, callbacks: MapManagerCallbacks): void {
    const drag = this.routeShapeDrag;
    if (!drag) return;
    this.routeShapeDrag = null;

    if (drag.mapDraggingWasEnabled) this.map.dragging.enable();
    const element = this.routeHitLine.getElement();
    if (element) (element as SVGElement).style.cursor = 'grab';

    this.suppressNextMapClick = drag.moved;
    window.setTimeout(() => {
      this.suppressNextMapClick = false;
    }, 0);

    if (drag.moved) {
      callbacks.onRouteLegShape(drag.legIndex, event.latlng.lat, event.latlng.lng);
    } else {
      this.routeLine.setLatLngs(this.routePathLatLngs());
      callbacks.onLegSelected?.(drag.legIndex);
      this.suppressNextMapClick = true;
    }
    L.DomEvent.stop(event.originalEvent);
  }

  private routePathLatLngs(overrideLegIndex?: number, overridePoint?: L.LatLng): L.LatLng[] {
    if (this.renderedLegs.length === 0) {
      return this.renderedWaypoints.map((waypoint) => L.latLng(waypoint.lat, waypoint.lon));
    }

    const result: L.LatLng[] = [];
    this.renderedLegs.forEach((leg, legIndex) => {
      const path = overrideLegIndex === legIndex && overridePoint
        ? [leg.from, { lat: overridePoint.lat, lon: overridePoint.lng }, leg.to]
        : routeLegPath(leg);
      densifyRoutePath(path).forEach((point, pointIndex) => {
        if (legIndex > 0 && pointIndex === 0) return;
        result.push(L.latLng(point.lat, point.lon));
      });
    });
    return result;
  }

  private closestLegIndex(latlng: L.LatLng): number {
    if (this.renderedLegs.length === 0) return -1;
    const target = this.map.latLngToContainerPoint(latlng);
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (const leg of this.renderedLegs) {
      const path = densifyRoutePath(routeLegPath(leg));
      for (let pathIndex = 0; pathIndex < path.length - 1; pathIndex += 1) {
        const from = path[pathIndex];
        const to = path[pathIndex + 1];
        const start = this.map.latLngToContainerPoint([from.lat, from.lon]);
        const end = this.map.latLngToContainerPoint([to.lat, to.lon]);
        const distance = squaredDistanceToSegment(target, start, end);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestIndex = leg.index;
        }
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
