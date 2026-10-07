import type { Coordinate } from '../types';
import { densifyRoutePath, initialTrueTrackDeg } from './geodesy';
import { degreesToRadians, normalizeDegrees, radiansToDegrees } from '../utils/angles';

const WGS84_A_METERS = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B_METERS = WGS84_A_METERS * (1 - WGS84_F);
export const MSA_CORRIDOR_HALF_WIDTH_NM = 1;
export const MSA_CORRIDOR_HALF_WIDTH_METERS = 1852;

export function destinationCoordinate(
  start: Coordinate,
  bearingDeg: number,
  distanceNm: number,
): Coordinate {
  if (!Number.isFinite(start.lat) || !Number.isFinite(start.lon) ||
    Math.abs(start.lat) > 90 || Math.abs(start.lon) > 180 ||
    !Number.isFinite(bearingDeg) || !Number.isFinite(distanceNm) || distanceNm < 0) {
    throw new Error('Invalid destination coordinate inputs.');
  }
  if (distanceNm === 0) return { ...start };
  // Vincenty's direct geodesic on WGS84. A spherical 1 NM offset at Norwegian
  // latitudes can extend several metres beyond 1852 m on the ellipsoid.
  // Formula source: https://www.ngs.noaa.gov/PUBS_LIB/inverse.pdf
  const bearing = degreesToRadians(normalizeDegrees(bearingDeg));
  const reducedLatitude = Math.atan((1 - WGS84_F) * Math.tan(degreesToRadians(start.lat)));
  const sinU = Math.sin(reducedLatitude), cosU = Math.cos(reducedLatitude);
  const sinBearing = Math.sin(bearing), cosBearing = Math.cos(bearing);
  const sigma1 = Math.atan2(Math.tan(reducedLatitude), cosBearing);
  const sinAlpha = cosU * sinBearing;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = cosSqAlpha * (WGS84_A_METERS ** 2 - WGS84_B_METERS ** 2) / WGS84_B_METERS ** 2;
  const A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const baseSigma = distanceNm * 1852 / (WGS84_B_METERS * A);
  let sigma = baseSigma;
  let converged = false;
  for (let iteration = 0; iteration < 100; iteration++) {
    const cosTwoSigmaM = Math.cos(2 * sigma1 + sigma);
    const sinSigma = Math.sin(sigma), cosSigma = Math.cos(sigma);
    const deltaSigma = B * sinSigma * (cosTwoSigmaM + B / 4 *
      (cosSigma * (-1 + 2 * cosTwoSigmaM ** 2) - B / 6 * cosTwoSigmaM *
        (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cosTwoSigmaM ** 2)));
    const next = baseSigma + deltaSigma;
    if (Math.abs(next - sigma) < 1e-12) { sigma = next; converged = true; break; }
    sigma = next;
  }
  if (!converged) throw new Error('Destination coordinate did not converge.');
  const sinSigma = Math.sin(sigma), cosSigma = Math.cos(sigma);
  const cosTwoSigmaM = Math.cos(2 * sigma1 + sigma);
  const temp = sinU * sinSigma - cosU * cosSigma * cosBearing;
  const latitude = Math.atan2(sinU * cosSigma + cosU * sinSigma * cosBearing,
    (1 - WGS84_F) * Math.hypot(sinAlpha, temp));
  const lambda = Math.atan2(sinSigma * sinBearing, cosU * cosSigma - sinU * sinSigma * cosBearing);
  const C = WGS84_F / 16 * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
  const L = lambda - (1 - C) * WGS84_F * sinAlpha * (sigma + C * sinSigma *
    (cosTwoSigmaM + C * cosSigma * (-1 + 2 * cosTwoSigmaM ** 2)));
  return { lat: radiansToDegrees(latitude), lon: normalizeLongitude(start.lon + radiansToDegrees(L)) };
}

export function buildLegCorridorPolygon(
  from: Coordinate,
  to: Coordinate,
  halfWidthNm = MSA_CORRIDOR_HALF_WIDTH_NM,
): Coordinate[] {
  if (!Number.isFinite(halfWidthNm) || halfWidthNm <= 0) {
    throw new Error('MSA corridor half-width must be greater than zero.');
  }

  const path = densifyRoutePath([from, to]);
  const left: Coordinate[] = [], right: Coordinate[] = [];
  path.forEach((point, index) => {
    const course = index === path.length - 1
      ? normalizeDegrees(initialTrueTrackDeg(point, path[index - 1]) + 180)
      : initialTrueTrackDeg(point, path[index + 1]);
    left.push(destinationCoordinate(point, course - 90, halfWidthNm));
    right.push(destinationCoordinate(point, course + 90, halfWidthNm));
  });
  return [...left, ...right.reverse()];
}

function normalizeLongitude(value: number): number {
  return ((value + 540) % 360) - 180;
}
