import type { Coordinate } from '../types';
import { initialTrueTrackDeg } from './geodesy';
import { degreesToRadians, normalizeDegrees, radiansToDegrees } from '../utils/angles';

const EARTH_RADIUS_NM = 3440.065;
export const MSA_CORRIDOR_HALF_WIDTH_NM = 1;
export const MSA_CORRIDOR_HALF_WIDTH_METERS = 1852;

export function destinationCoordinate(
  start: Coordinate,
  bearingDeg: number,
  distanceNm: number,
): Coordinate {
  const angularDistance = distanceNm / EARTH_RADIUS_NM;
  const bearing = degreesToRadians(normalizeDegrees(bearingDeg));
  const lat1 = degreesToRadians(start.lat);
  const lon1 = degreesToRadians(start.lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
    Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
    Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
  );

  return {
    lat: radiansToDegrees(lat2),
    lon: normalizeLongitude(radiansToDegrees(lon2)),
  };
}

export function buildLegCorridorPolygon(
  from: Coordinate,
  to: Coordinate,
  halfWidthNm = MSA_CORRIDOR_HALF_WIDTH_NM,
): Coordinate[] {
  if (!Number.isFinite(halfWidthNm) || halfWidthNm <= 0) {
    throw new Error('MSA corridor half-width must be greater than zero.');
  }

  const startCourse = initialTrueTrackDeg(from, to);
  const endCourse = normalizeDegrees(initialTrueTrackDeg(to, from) + 180);

  const leftFrom = destinationCoordinate(from, startCourse - 90, halfWidthNm);
  const leftTo = destinationCoordinate(to, endCourse - 90, halfWidthNm);
  const rightTo = destinationCoordinate(to, endCourse + 90, halfWidthNm);
  const rightFrom = destinationCoordinate(from, startCourse + 90, halfWidthNm);

  return [leftFrom, leftTo, rightTo, rightFrom];
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}
