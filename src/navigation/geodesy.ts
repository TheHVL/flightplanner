import type { Coordinate, RouteLeg, Waypoint } from '../types';
import { degreesToRadians, normalizeDegrees, radiansToDegrees } from '../utils/angles';

const EARTH_RADIUS_NM = 3440.065;

export function greatCircleDistanceNm(a: Coordinate, b: Coordinate): number {
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLat = degreesToRadians(b.lat - a.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);

  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;

  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
  return EARTH_RADIUS_NM * centralAngle;
}

export function initialTrueTrackDeg(a: Coordinate, b: Coordinate): number {
  const lat1 = degreesToRadians(a.lat);
  const lat2 = degreesToRadians(b.lat);
  const deltaLon = degreesToRadians(b.lon - a.lon);

  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);

  return normalizeDegrees(radiansToDegrees(Math.atan2(y, x)));
}

export function routeLegKey(fromId: string, toId: string): string {
  return `${fromId}->${toId}`;
}

export function calculateRouteLegs(
  waypoints: Waypoint[],
  routeShapePoints: ReadonlyMap<string, Coordinate> = new Map(),
): RouteLeg[] {
  return waypoints.slice(0, -1).map((from, index) => {
    const to = waypoints[index + 1];
    const shapePoint = routeShapePoints.get(routeLegKey(from.id, to.id));
    const path: Coordinate[] = shapePoint
      ? [from, { ...shapePoint }, to]
      : [from, to];
    const distanceNm = path
      .slice(0, -1)
      .reduce((sum, point, pathIndex) => sum + greatCircleDistanceNm(point, path[pathIndex + 1]), 0);

    return {
      index,
      from,
      to,
      distanceNm,
      directDistanceNm: greatCircleDistanceNm(from, to),
      trueTrackDeg: initialTrueTrackDeg(from, to),
      path,
    };
  });
}

export function totalRouteDistanceNm(legs: RouteLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
}
