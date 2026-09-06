import type { Coordinate, RouteLeg } from '../types';
import { totalRouteDistanceNm } from './geodesy';

export interface VerticalProfileInput {
  legs: RouteLeg[];
  departureElevationFt: number;
  destinationElevationFt: number;
  initialPlannedAltitudeFt: number;
  finalPlannedAltitudeFt: number;
  climbRateFpm: number;
  descentRateFpm: number;
  climbGroundSpeedKt: number;
  descentGroundSpeedKt: number;
}

export interface VerticalProfileResult {
  routeDistanceNm: number;
  climbAltitudeGainFt: number;
  descentAltitudeLossFt: number;
  climbTimeMin: number;
  descentTimeMin: number;
  climbDistanceNm: number;
  descentDistanceNm: number;
  tocDistanceFromDepartureNm: number;
  todDistanceFromDepartureNm: number;
  todDistanceToDestinationNm: number;
  levelDistanceNm: number;
  profilesOverlap: boolean;
  overlapDistanceNm: number;
  tocOnRoute: boolean;
  todOnRoute: boolean;
  tocCoordinate: Coordinate | null;
  todCoordinate: Coordinate | null;
}

export function calculateVerticalProfile(input: VerticalProfileInput): VerticalProfileResult {
  const {
    legs,
    departureElevationFt,
    destinationElevationFt,
    initialPlannedAltitudeFt,
    finalPlannedAltitudeFt,
    climbRateFpm,
    descentRateFpm,
    climbGroundSpeedKt,
    descentGroundSpeedKt,
  } = input;

  if (legs.length === 0) throw new Error('Add at least two waypoints before calculating TOC/TOD.');
  validateFiniteNonNegative(departureElevationFt, 'Departure elevation');
  validateFiniteNonNegative(destinationElevationFt, 'Destination elevation');
  validateFiniteNonNegative(initialPlannedAltitudeFt, 'Initial planned altitude');
  validateFiniteNonNegative(finalPlannedAltitudeFt, 'Final planned altitude');
  validatePositive(climbRateFpm, 'Climb rate');
  validatePositive(descentRateFpm, 'Descent rate');
  validatePositive(climbGroundSpeedKt, 'Climb groundspeed');
  validatePositive(descentGroundSpeedKt, 'Descent groundspeed');

  const routeDistanceNm = totalRouteDistanceNm(legs);
  const climbAltitudeGainFt = Math.max(0, initialPlannedAltitudeFt - departureElevationFt);
  const descentAltitudeLossFt = Math.max(0, finalPlannedAltitudeFt - destinationElevationFt);
  const climbTimeMin = climbAltitudeGainFt / climbRateFpm;
  const descentTimeMin = descentAltitudeLossFt / descentRateFpm;
  const climbDistanceNm = climbGroundSpeedKt * (climbTimeMin / 60);
  const descentDistanceNm = descentGroundSpeedKt * (descentTimeMin / 60);
  const tocDistanceFromDepartureNm = climbDistanceNm;
  const todDistanceFromDepartureNm = routeDistanceNm - descentDistanceNm;
  const profilesOverlap = climbDistanceNm + descentDistanceNm > routeDistanceNm;
  const overlapDistanceNm = Math.max(0, climbDistanceNm + descentDistanceNm - routeDistanceNm);
  const levelDistanceNm = Math.max(0, todDistanceFromDepartureNm - tocDistanceFromDepartureNm);
  const tocOnRoute = tocDistanceFromDepartureNm >= 0 && tocDistanceFromDepartureNm <= routeDistanceNm;
  const todOnRoute = todDistanceFromDepartureNm >= 0 && todDistanceFromDepartureNm <= routeDistanceNm;

  return {
    routeDistanceNm,
    climbAltitudeGainFt,
    descentAltitudeLossFt,
    climbTimeMin,
    descentTimeMin,
    climbDistanceNm,
    descentDistanceNm,
    tocDistanceFromDepartureNm,
    todDistanceFromDepartureNm,
    todDistanceToDestinationNm: descentDistanceNm,
    levelDistanceNm,
    profilesOverlap,
    overlapDistanceNm,
    tocOnRoute,
    todOnRoute,
    tocCoordinate: tocOnRoute ? routeCoordinateAtDistance(legs, tocDistanceFromDepartureNm) : null,
    todCoordinate: todOnRoute ? routeCoordinateAtDistance(legs, todDistanceFromDepartureNm) : null,
  };
}

export function routeCoordinateAtDistance(legs: RouteLeg[], distanceFromDepartureNm: number): Coordinate | null {
  if (legs.length === 0 || !Number.isFinite(distanceFromDepartureNm)) return null;
  const routeDistanceNm = totalRouteDistanceNm(legs);
  const target = Math.min(routeDistanceNm, Math.max(0, distanceFromDepartureNm));
  let accumulated = 0;

  for (const leg of legs) {
    const legEnd = accumulated + leg.distanceNm;
    if (target <= legEnd || leg === legs[legs.length - 1]) {
      const fraction = leg.distanceNm <= 1e-9 ? 0 : (target - accumulated) / leg.distanceNm;
      return interpolateGreatCircle(leg.from, leg.to, Math.min(1, Math.max(0, fraction)));
    }
    accumulated = legEnd;
  }

  const last = legs[legs.length - 1].to;
  return { lat: last.lat, lon: last.lon };
}

function interpolateGreatCircle(a: Coordinate, b: Coordinate, fraction: number): Coordinate {
  if (fraction <= 0) return { lat: a.lat, lon: a.lon };
  if (fraction >= 1) return { lat: b.lat, lon: b.lon };

  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;
  const lat1 = a.lat * toRad;
  const lon1 = a.lon * toRad;
  const lat2 = b.lat * toRad;
  const lon2 = b.lon * toRad;
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
    lat: Math.atan2(z, Math.hypot(x, y)) * toDeg,
    lon: Math.atan2(y, x) * toDeg,
  };
}

function validatePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero.`);
}

function validateFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} cannot be negative.`);
}
