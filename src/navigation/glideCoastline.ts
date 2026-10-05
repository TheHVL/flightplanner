import type { Coordinate } from '../types';
import type { GlideEnvelopeSample } from './glideEnvelope';

const GRID_SIZE_DEG = 1;
const NM_PER_DEG_LAT = 60;
const MARGINAL_MARGIN_NM = 1;

type Position = [number, number];
type LinearRing = Position[];
type PolygonCoordinates = LinearRing[];
type MultiPolygonCoordinates = PolygonCoordinates[];

interface GeoJsonGeometry {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: PolygonCoordinates | MultiPolygonCoordinates;
}

interface GeoJsonFeature {
  type: 'Feature';
  geometry: GeoJsonGeometry | null;
}

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection';
  features: GeoJsonFeature[];
  clipBounds?: [number, number, number, number];
}

interface PreparedPolygon {
  rings: Coordinate[][];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

interface CoastSegment {
  id: number;
  a: Coordinate;
  b: Coordinate;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

export interface PreparedLandMask {
  polygons: PreparedPolygon[];
  segmentGrid: Map<string, CoastSegment[]>;
  coverage: {
    minLon: number;
    minLat: number;
    maxLon: number;
    maxLat: number;
  };
}

export type GlideCoastlineStatus =
  | 'land'
  | 'water-reachable'
  | 'water-marginal'
  | 'water-unreachable'
  | 'outside-coverage';

export interface GlideCoastlineSample extends GlideEnvelopeSample {
  status: GlideCoastlineStatus;
  coastlineDistanceNm: number | null;
  coastlineMarginNm: number | null;
}

export interface GlideCoastlineMapSegment {
  severity: 'marginal' | 'unreachable';
  from: Coordinate;
  to: Coordinate;
  startRouteDistanceNm: number;
  endRouteDistanceNm: number;
}

export interface GlideCoastlineAnalysis {
  samples: GlideCoastlineSample[];
  mapSegments: GlideCoastlineMapSegment[];
  waterSampleCount: number;
  marginalSampleCount: number;
  unreachableSampleCount: number;
  outsideCoverageSampleCount: number;
  estimatedMarginalRouteNm: number;
  estimatedUnreachableRouteNm: number;
  minimumReachableMarginNm: number | null;
  warnings: string[];
}

let cachedLandMaskPromise: Promise<PreparedLandMask> | null = null;

export function loadNordicLandMask(url: string): Promise<PreparedLandMask> {
  if (!cachedLandMaskPromise) {
    cachedLandMaskPromise = fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Coastline dataset request failed with HTTP ${response.status}.`);
        }
        return prepareLandMask(await response.json());
      })
      .catch((error) => {
        cachedLandMaskPromise = null;
        throw error;
      });
  }
  return cachedLandMaskPromise;
}

export function prepareLandMask(value: unknown): PreparedLandMask {
  if (!isFeatureCollection(value)) {
    throw new Error('Coastline dataset is not a supported GeoJSON FeatureCollection.');
  }

  const polygons: PreparedPolygon[] = [];
  const segments: CoastSegment[] = [];
  let segmentId = 0;

  for (const feature of value.features) {
    if (!feature.geometry) continue;
    const polygonCoordinates = feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as PolygonCoordinates]
      : feature.geometry.coordinates as MultiPolygonCoordinates;

    for (const polygon of polygonCoordinates) {
      const rings = polygon
        .map((ring) => ring
          .filter((position) => validPosition(position))
          .map(([lon, lat]) => ({ lat, lon })))
        .filter((ring) => ring.length >= 4);

      if (rings.length === 0) continue;

      const allPoints = rings.flat();
      const prepared: PreparedPolygon = {
        rings,
        minLat: Math.min(...allPoints.map((point) => point.lat)),
        maxLat: Math.max(...allPoints.map((point) => point.lat)),
        minLon: Math.min(...allPoints.map((point) => point.lon)),
        maxLon: Math.max(...allPoints.map((point) => point.lon)),
      };
      polygons.push(prepared);

      for (const ring of rings) {
        for (let index = 0; index < ring.length - 1; index += 1) {
          const a = ring[index];
          const b = ring[index + 1];
          segments.push({
            id: segmentId,
            a,
            b,
            minLat: Math.min(a.lat, b.lat),
            maxLat: Math.max(a.lat, b.lat),
            minLon: Math.min(a.lon, b.lon),
            maxLon: Math.max(a.lon, b.lon),
          });
          segmentId += 1;
        }
      }
    }
  }

  if (polygons.length === 0 || segments.length === 0) {
    throw new Error('Coastline dataset contains no usable land polygons.');
  }

  const coverage = parseCoverage(value.clipBounds, polygons);
  const segmentGrid = buildSegmentGrid(segments);
  return { polygons, segmentGrid, coverage };
}

export function analyzeGlideCoastline(
  glideSamples: GlideEnvelopeSample[],
  landMask: PreparedLandMask,
): GlideCoastlineAnalysis {
  if (glideSamples.length === 0) {
    return {
      samples: [],
      mapSegments: [],
      waterSampleCount: 0,
      marginalSampleCount: 0,
      unreachableSampleCount: 0,
      outsideCoverageSampleCount: 0,
      estimatedMarginalRouteNm: 0,
      estimatedUnreachableRouteNm: 0,
      minimumReachableMarginNm: null,
      warnings: [],
    };
  }

  const samples: GlideCoastlineSample[] = glideSamples.map((sample) => {
    const point = { lat: sample.lat, lon: sample.lon };
    if (!insideCoverage(point, landMask.coverage)) {
      return {
        ...sample,
        status: 'outside-coverage' as const,
        coastlineDistanceNm: null,
        coastlineMarginNm: null,
      };
    }

    if (pointOnLand(point, landMask.polygons)) {
      return {
        ...sample,
        status: 'land' as const,
        coastlineDistanceNm: 0,
        coastlineMarginNm: sample.glideRangeNm,
      };
    }

    const coastlineDistanceNm = nearestCoastlineWithinRangeNm(
      point,
      Math.max(0, sample.glideRangeNm),
      landMask.segmentGrid,
    );

    if (coastlineDistanceNm === null) {
      return {
        ...sample,
        status: 'water-unreachable' as const,
        coastlineDistanceNm: null,
        coastlineMarginNm: null,
      };
    }

    const coastlineMarginNm = sample.glideRangeNm - coastlineDistanceNm;
    return {
      ...sample,
      status: coastlineMarginNm <= MARGINAL_MARGIN_NM
        ? 'water-marginal' as const
        : 'water-reachable' as const,
      coastlineDistanceNm,
      coastlineMarginNm,
    };
  });

  const mapSegments: GlideCoastlineMapSegment[] = [];
  for (let index = 0; index < samples.length - 1; index += 1) {
    const a = samples[index];
    const b = samples[index + 1];
    const severity = segmentSeverity(a.status, b.status);
    if (!severity) continue;
    mapSegments.push({
      severity,
      from: { lat: a.lat, lon: a.lon },
      to: { lat: b.lat, lon: b.lon },
      startRouteDistanceNm: a.routeDistanceNm,
      endRouteDistanceNm: b.routeDistanceNm,
    });
  }

  const waterSamples = samples.filter((sample) => sample.status.startsWith('water-'));
  const marginalSamples = samples.filter((sample) => sample.status === 'water-marginal');
  const unreachableSamples = samples.filter((sample) => sample.status === 'water-unreachable');
  const outsideCoverageSamples = samples.filter((sample) => sample.status === 'outside-coverage');
  const reachableMargins = samples
    .filter((sample) => sample.status === 'water-reachable' || sample.status === 'water-marginal')
    .map((sample) => sample.coastlineMarginNm)
    .filter((margin): margin is number => margin !== null && Number.isFinite(margin));

  const estimatedMarginalRouteNm = estimateStatusRouteDistance(samples, 'water-marginal');
  const estimatedUnreachableRouteNm = estimateStatusRouteDistance(samples, 'water-unreachable');
  const warnings: string[] = [];

  if (outsideCoverageSamples.length > 0) {
    warnings.push('Some route samples are outside the bundled Nordic coastline dataset coverage.');
  }
  warnings.push(
    'Coastline screening uses generalized Natural Earth 1:10m land data and can omit small islands or fine shoreline detail.',
  );

  return {
    samples,
    mapSegments,
    waterSampleCount: waterSamples.length,
    marginalSampleCount: marginalSamples.length,
    unreachableSampleCount: unreachableSamples.length,
    outsideCoverageSampleCount: outsideCoverageSamples.length,
    estimatedMarginalRouteNm,
    estimatedUnreachableRouteNm,
    minimumReachableMarginNm: reachableMargins.length > 0 ? Math.min(...reachableMargins) : null,
    warnings,
  };
}

function segmentSeverity(
  a: GlideCoastlineStatus,
  b: GlideCoastlineStatus,
): GlideCoastlineMapSegment['severity'] | null {
  if (a === 'outside-coverage' || b === 'outside-coverage') return null;
  if (a === 'water-unreachable' || b === 'water-unreachable') return 'unreachable';
  if (a === 'water-marginal' || b === 'water-marginal') return 'marginal';
  return null;
}

function estimateStatusRouteDistance(
  samples: GlideCoastlineSample[],
  status: GlideCoastlineStatus,
): number {
  if (samples.length < 2) return 0;

  let total = 0;
  for (let index = 0; index < samples.length; index += 1) {
    if (samples[index].status !== status) continue;
    const previousDistance = index === 0
      ? samples[index].routeDistanceNm
      : (samples[index - 1].routeDistanceNm + samples[index].routeDistanceNm) / 2;
    const nextDistance = index === samples.length - 1
      ? samples[index].routeDistanceNm
      : (samples[index].routeDistanceNm + samples[index + 1].routeDistanceNm) / 2;
    total += Math.max(0, nextDistance - previousDistance);
  }
  return total;
}

function pointOnLand(point: Coordinate, polygons: PreparedPolygon[]): boolean {
  for (const polygon of polygons) {
    if (
      point.lat < polygon.minLat ||
      point.lat > polygon.maxLat ||
      point.lon < polygon.minLon ||
      point.lon > polygon.maxLon
    ) continue;

    if (!pointInRing(point, polygon.rings[0])) continue;
    const insideHole = polygon.rings.slice(1).some((ring) => pointInRing(point, ring));
    if (!insideHole) return true;
  }
  return false;
}

function pointInRing(point: Coordinate, ring: Coordinate[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    const intersects =
      (a.lat > point.lat) !== (b.lat > point.lat) &&
      point.lon < ((b.lon - a.lon) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lon;
    if (intersects) inside = !inside;
  }
  return inside;
}

function nearestCoastlineWithinRangeNm(
  point: Coordinate,
  rangeNm: number,
  grid: Map<string, CoastSegment[]>,
): number | null {
  if (!Number.isFinite(rangeNm) || rangeNm <= 0) return null;

  const cosLat = Math.max(0.08, Math.cos((point.lat * Math.PI) / 180));
  const latRadiusDeg = rangeNm / NM_PER_DEG_LAT;
  const lonRadiusDeg = rangeNm / (NM_PER_DEG_LAT * cosLat);
  const minLatCell = Math.floor((point.lat - latRadiusDeg) / GRID_SIZE_DEG);
  const maxLatCell = Math.floor((point.lat + latRadiusDeg) / GRID_SIZE_DEG);
  const minLonCell = Math.floor((point.lon - lonRadiusDeg) / GRID_SIZE_DEG);
  const maxLonCell = Math.floor((point.lon + lonRadiusDeg) / GRID_SIZE_DEG);

  let nearest = Number.POSITIVE_INFINITY;
  const visited = new Set<number>();

  for (let latCell = minLatCell; latCell <= maxLatCell; latCell += 1) {
    for (let lonCell = minLonCell; lonCell <= maxLonCell; lonCell += 1) {
      const segments = grid.get(gridKey(latCell, lonCell));
      if (!segments) continue;
      for (const segment of segments) {
        if (visited.has(segment.id)) continue;
        visited.add(segment.id);
        if (
          segment.maxLat < point.lat - latRadiusDeg ||
          segment.minLat > point.lat + latRadiusDeg ||
          segment.maxLon < point.lon - lonRadiusDeg ||
          segment.minLon > point.lon + lonRadiusDeg
        ) continue;

        const distanceNm = localPointToSegmentDistanceNm(point, segment.a, segment.b);
        if (distanceNm < nearest) nearest = distanceNm;
      }
    }
  }

  return nearest <= rangeNm + 1e-6 ? nearest : null;
}

function localPointToSegmentDistanceNm(
  point: Coordinate,
  a: Coordinate,
  b: Coordinate,
): number {
  const cosLat = Math.max(0.08, Math.cos((point.lat * Math.PI) / 180));
  const ax = (a.lon - point.lon) * NM_PER_DEG_LAT * cosLat;
  const ay = (a.lat - point.lat) * NM_PER_DEG_LAT;
  const bx = (b.lon - point.lon) * NM_PER_DEG_LAT * cosLat;
  const by = (b.lat - point.lat) * NM_PER_DEG_LAT;

  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(ax, ay);

  const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSquared));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function buildSegmentGrid(segments: CoastSegment[]): Map<string, CoastSegment[]> {
  const grid = new Map<string, CoastSegment[]>();
  for (const segment of segments) {
    const minLatCell = Math.floor(segment.minLat / GRID_SIZE_DEG);
    const maxLatCell = Math.floor(segment.maxLat / GRID_SIZE_DEG);
    const minLonCell = Math.floor(segment.minLon / GRID_SIZE_DEG);
    const maxLonCell = Math.floor(segment.maxLon / GRID_SIZE_DEG);
    for (let latCell = minLatCell; latCell <= maxLatCell; latCell += 1) {
      for (let lonCell = minLonCell; lonCell <= maxLonCell; lonCell += 1) {
        const key = gridKey(latCell, lonCell);
        const bucket = grid.get(key);
        if (bucket) bucket.push(segment);
        else grid.set(key, [segment]);
      }
    }
  }
  return grid;
}

function gridKey(latCell: number, lonCell: number): string {
  return `${latCell}:${lonCell}`;
}

function insideCoverage(
  point: Coordinate,
  coverage: PreparedLandMask['coverage'],
): boolean {
  return point.lon >= coverage.minLon &&
    point.lon <= coverage.maxLon &&
    point.lat >= coverage.minLat &&
    point.lat <= coverage.maxLat;
}

function parseCoverage(
  clipBounds: GeoJsonFeatureCollection['clipBounds'],
  polygons: PreparedPolygon[],
): PreparedLandMask['coverage'] {
  if (
    Array.isArray(clipBounds) &&
    clipBounds.length === 4 &&
    clipBounds.every((value) => typeof value === 'number' && Number.isFinite(value))
  ) {
    return {
      minLon: clipBounds[0],
      minLat: clipBounds[1],
      maxLon: clipBounds[2],
      maxLat: clipBounds[3],
    };
  }

  return {
    minLon: Math.min(...polygons.map((polygon) => polygon.minLon)),
    minLat: Math.min(...polygons.map((polygon) => polygon.minLat)),
    maxLon: Math.max(...polygons.map((polygon) => polygon.maxLon)),
    maxLat: Math.max(...polygons.map((polygon) => polygon.maxLat)),
  };
}

function isFeatureCollection(value: unknown): value is GeoJsonFeatureCollection {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.type === 'FeatureCollection' && Array.isArray(record.features);
}

function validPosition(value: unknown): value is Position {
  return Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}
