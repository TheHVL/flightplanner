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

export function routeLegPath(leg: RouteLeg): Coordinate[] {
  return leg.path?.length && leg.path.length >= 2 ? leg.path : [leg.from, leg.to];
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

/** Return a coordinate on the plotted/flown path at cumulative route distance. */
export function coordinateAtRouteDistance(legs: RouteLeg[], distanceFromDepartureNm: number): Coordinate | null {
  if (legs.length === 0 || !Number.isFinite(distanceFromDepartureNm)) return null;
  const routeDistanceNm = totalRouteDistanceNm(legs);
  let remaining = Math.min(routeDistanceNm, Math.max(0, distanceFromDepartureNm));

  for (const leg of legs) {
    const path = routeLegPath(leg);
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      const segmentDistanceNm = greatCircleDistanceNm(from, to);
      if (remaining <= segmentDistanceNm || (leg === legs[legs.length - 1] && index === path.length - 2)) {
        const fraction = segmentDistanceNm <= 1e-9 ? 0 : remaining / segmentDistanceNm;
        return interpolateGreatCircle(from, to, Math.min(1, Math.max(0, fraction)));
      }
      remaining -= segmentDistanceNm;
    }
  }

  const last = legs[legs.length - 1].to;
  return { lat: last.lat, lon: last.lon };
}

/** Local visual track of the plotted path at cumulative route distance. */
export function trackAtRouteDistance(legs: RouteLeg[], distanceFromDepartureNm: number): number {
  if (legs.length === 0 || !Number.isFinite(distanceFromDepartureNm)) return 0;
  const routeDistanceNm = totalRouteDistanceNm(legs);
  let remaining = Math.min(routeDistanceNm, Math.max(0, distanceFromDepartureNm));

  for (const leg of legs) {
    const path = routeLegPath(leg);
    for (let index = 0; index < path.length - 1; index += 1) {
      const from = path[index];
      const to = path[index + 1];
      const segmentDistanceNm = greatCircleDistanceNm(from, to);
      if (remaining <= segmentDistanceNm || (leg === legs[legs.length - 1] && index === path.length - 2)) {
        return initialTrueTrackDeg(from, to);
      }
      remaining -= segmentDistanceNm;
    }
  }

  return legs[legs.length - 1].trueTrackDeg;
}

function interpolateGreatCircle(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  if (fraction <= 0) return { lat: a.lat, lon: a.lon };
  if (fraction >= 1) return { lat: b.lat, lon: b.lon };

  const lat1 = degreesToRadians(a.lat);
  const lon1 = degreesToRadians(a.lon);
  const lat2 = degreesToRadians(b.lat);
  const lon2 = degreesToRadians(b.lon);
  const cosDelta = Math.min(
    1,
    Math.max(-1, Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1)),
  );
  const delta = Math.acos(cosDelta);
  if (delta < 1e-10) return { lat: a.lat, lon: a.lon };

  const sinDelta = Math.sin(delta);
  const weightA = Math.sin((1 - fraction) * delta) / sinDelta;
  const weightB = Math.sin(fraction * delta) / sinDelta;
  const x = weightA * Math.cos(lat1) * Math.cos(lon1) + weightB * Math.cos(lat2) * Math.cos(lon2);
  const y = weightA * Math.cos(lat1) * Math.sin(lon1) + weightB * Math.cos(lat2) * Math.sin(lon2);
  const z = weightA * Math.sin(lat1) + weightB * Math.sin(lat2);

  return {
    lat: radiansToDegrees(Math.atan2(z, Math.hypot(x, y))),
    lon: radiansToDegrees(Math.atan2(y, x)),
  };
}
