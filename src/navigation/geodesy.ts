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

export function calculateRouteLegs(waypoints: Waypoint[]): RouteLeg[] {
  return waypoints.slice(0, -1).map((from, index) => {
    const to = waypoints[index + 1];
    return {
      index,
      from,
      to,
      distanceNm: greatCircleDistanceNm(from, to),
      trueTrackDeg: initialTrueTrackDeg(from, to),
    };
  });
}

export function totalRouteDistanceNm(legs: RouteLeg[]): number {
  return legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
}
