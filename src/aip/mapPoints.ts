import type { Coordinate } from '../types';
import type { AipAerodromeCatalog } from './aerodromes';
import { greatCircleDistanceNm } from '../navigation/geodesy';

export interface PublishedMapPoint extends Coordinate {
  name: string;
  aipId: string;
  aipEffectiveDate: string;
  kind: 'airport' | 'reporting-point';
  aerodromeIcao: string;
  elevationFt?: number;
  sourceUrl: string;
  remarks?: string;
}

export function publishedMapPoints(catalog: AipAerodromeCatalog): PublishedMapPoint[] {
  return [
    ...catalog.aerodromes.filter(a => a.lat !== null && a.lon !== null).map(a => ({
      name: a.icao, aipId: a.icao, aipEffectiveDate: catalog.effectiveDate,
      lat: a.lat!, lon: a.lon!, kind: 'airport' as const, aerodromeIcao: a.icao,
      elevationFt: a.elevationFt, sourceUrl: a.sourceUrl,
    })),
    ...(catalog.reportingPoints ?? []).map(p => ({
      name: p.name, aipId: p.id, aipEffectiveDate: catalog.effectiveDate,
      lat: p.lat, lon: p.lon, kind: 'reporting-point' as const, aerodromeIcao: p.aerodromeIcao,
      sourceUrl: p.sourceUrl, remarks: p.remarks,
    })),
  ];
}

/** Limit both screen distance and ground distance so zooming out never captures a distant point. */
export function nearestPublishedPoint(
  coordinate: Coordinate, points: PublishedMapPoint[],
  project: (point: Coordinate) => { x: number; y: number },
  radiusPx = 14, maximumNm = 0.5,
): PublishedMapPoint | undefined {
  const click = project(coordinate);
  let nearest: PublishedMapPoint | undefined, best = radiusPx;
  for (const point of points) {
    if (greatCircleDistanceNm(coordinate, point) > maximumNm) continue;
    const pixel = project(point), distance = Math.hypot(pixel.x - click.x, pixel.y - click.y);
    if (distance <= best) { nearest = point; best = distance; }
  }
  return nearest;
}
