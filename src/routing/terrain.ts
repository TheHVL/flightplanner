import type { Coordinate, RouteLeg } from '../types';
import { coordinateAtRouteDistance, trackAtRouteDistance, greatCircleDistanceNm, routeLegPath } from '../navigation/geodesy';
import { destinationCoordinate } from '../navigation/msaCorridor';

export const TERRAIN_SOURCE_URL = 'https://ws.geonorge.no/hoydedata/v1/';
export const TERRAIN_SPACING_NM = 0.5;
export const TERRAIN_HALF_WIDTH_NM = 1;
export interface TerrainProbe extends Coordinate {
  legIndex: number;
  distanceNm: number;
  offsetNm: number;
  altitudeFt: number | null;
}
export interface TerrainHeight {
  elevationFt: number;
  terrain: string;
  dataset: string;
}
export interface TerrainReview {
  probes: TerrainProbe[];
  heights: Array<TerrainHeight | null>;
  fetchedAt: string;
  sourceUrl: string;
  failedBatches: number;
}

/** A sampled strip, not a raster maximum or an obstacle survey. Includes bends. */
export function buildTerrainProbes(legs: RouteLeg[], altitudeAt: (leg: RouteLeg, distanceNm: number) => number | null): TerrainProbe[] {
  const probes: TerrainProbe[] = [];
  for (const leg of legs) {
    if (!Number.isFinite(leg.distanceNm) || leg.distanceNm < 0) throw new Error('Invalid route distance.');
    const steps = Math.max(1, Math.ceil(leg.distanceNm / TERRAIN_SPACING_NM));
    const distances = Array.from({ length: steps + 1 }, (_, i) => leg.distanceNm * i / steps);
    const path = routeLegPath(leg); let along = 0;
    for (let i = 1; i < path.length - 1; i++) { along += greatCircleDistanceNm(path[i - 1], path[i]); distances.push(along); }
    const positions = [...new Set(distances)].sort((a, b) => a - b);
    if (probes.length + positions.length * 5 > 6000) throw new Error('This route exceeds the 6000-point terrain check limit. Check shorter sections separately.');
    for (const distanceNm of positions) {
      const center = coordinateAtRouteDistance([leg], distanceNm)!;
      const bearing = trackAtRouteDistance([leg], distanceNm);
      for (const offsetNm of [-1, -0.5, 0, 0.5, 1]) {
        const point = offsetNm === 0 ? center : destinationCoordinate(center, bearing + (offsetNm > 0 ? 90 : -90), Math.abs(offsetNm));
        probes.push({ ...point, legIndex: leg.index, distanceNm, offsetNm, altitudeFt: altitudeAt(leg, distanceNm) });
      }
    }
  }
  return probes;
}

/** Match by coordinates: the service response need not preserve request order. */
export function parseTerrainHeights(value: unknown, points: Coordinate[]): Array<TerrainHeight | null> {
  const data = value as { koordsys?: number; punkter?: Array<{ x?: number; y?: number; z?: number | null; terreng?: string; datakilde?: string }> };
  if (!data || data.koordsys !== 4258 || !Array.isArray(data.punkter)) throw new Error('Kartverket returned an invalid height response.');
  return points.map(point => {
    const matches = data.punkter!.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && Math.abs(p.x! - point.lon) < 0.000001 && Math.abs(p.y! - point.lat) < 0.000001);
    if (matches.length !== 1) return null;
    const p = matches[0];
    if (!p.datakilde || !Number.isFinite(p.z) || p.z! < -12000 || p.z! > 9000) return null;
    // The live API may omit the N50 surface classification even for valid DTM
    // heights. Accept known height datasets there, never unclassified sea depth.
    const knownHeightDataset = ['dtm1', 'dom1', 'hoydekurver', 'innsjohoyde'].includes(p.datakilde);
    if (typeof p.terreng !== 'string' && (!knownHeightDataset || p.z! < 0)) return null;
    // /punkt returns seabed depth over the sea. Use its surface, never the depth.
    const elevationM = p.terreng === 'Havflate' ? 0 : p.z!;
    return { elevationFt: elevationM / 0.3048, terrain: p.terreng ?? 'Unknown surface type', dataset: p.datakilde };
  });
}

/** Fresh, bounded requests; partial failures are retained as missing coverage. */
export async function fetchTerrainReview(probes: TerrainProbe[], signal: AbortSignal, onProgress?: (done: number, total: number) => void): Promise<TerrainReview> {
  if (probes.length > 6000) throw new Error('Too many terrain points.');
  const heights: Array<TerrainHeight | null> = Array(probes.length).fill(null);
  let next = 0, done = 0, failedBatches = 0;
  const worker = async () => {
    while (next < probes.length) {
      signal.throwIfAborted();
      const start = next; next += 50;
      const points = probes.slice(start, start + 50);
      const pointKey = (point: Coordinate) => `${point.lon.toFixed(8)},${point.lat.toFixed(8)}`;
      const unique = [...new Map(points.map(point => [pointKey(point), point])).values()];
      const url = new URL('punkt', TERRAIN_SOURCE_URL);
      url.searchParams.set('koordsys', '4258');
      url.searchParams.set('punkter', JSON.stringify(unique.map(p => [Number(p.lon.toFixed(8)), Number(p.lat.toFixed(8))])));
      const timeout = new AbortController();
      const abort = () => timeout.abort(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => timeout.abort(), 20000);
      try {
        const response = await fetch(url, { signal: timeout.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(`Height service unavailable (${response.status}).`);
        const batch = parseTerrainHeights(await response.json(), unique);
        const byPoint = new Map(unique.map((point, i) => [pointKey(point), batch[i]]));
        points.forEach((point, i) => { heights[start + i] = byPoint.get(pointKey(point)) ?? null; });
      } catch {
        signal.throwIfAborted();
        failedBatches++;
      } finally {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
      }
      done += points.length; onProgress?.(done, probes.length);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  signal.throwIfAborted();
  return { probes, heights, fetchedAt: new Date().toISOString(), sourceUrl: TERRAIN_SOURCE_URL, failedBatches };
}

export function summarizeTerrainLeg(review: TerrainReview, legIndex: number): { count: number; missing: number; highestFt: number | null; minimumMarginFt: number | null; lowMarginCount: number; unknownAltitudeCount: number } {
  let count = 0, missing = 0, highestFt: number | null = null, minimumMarginFt: number | null = null, lowMarginCount = 0, unknownAltitudeCount = 0;
  review.probes.forEach((probe, i) => {
    if (probe.legIndex !== legIndex) return;
    count++;
    if (probe.altitudeFt === null || !Number.isFinite(probe.altitudeFt)) unknownAltitudeCount++;
    const height = review.heights[i];
    if (!height) { missing++; return; }
    highestFt = Math.max(highestFt ?? -Infinity, height.elevationFt);
    if (probe.altitudeFt === null || !Number.isFinite(probe.altitudeFt)) return;
    const margin = probe.altitudeFt - height.elevationFt;
    minimumMarginFt = Math.min(minimumMarginFt ?? Infinity, margin);
    if (margin < 500) lowMarginCount++;
  });
  return { count, missing, highestFt, minimumMarginFt, lowMarginCount, unknownAltitudeCount };
}
