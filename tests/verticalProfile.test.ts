import { describe, expect, it } from 'vitest';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import {
  calculateVerticalProfile,
  routeCoordinateAtDistance,
} from '../src/navigation/verticalProfile';
import type { Waypoint } from '../src/types';

const waypoint = (id: string, lat: number, lon: number): Waypoint => ({ id, name: id, lat, lon });

describe('vertical profile', () => {
  it('calculates TOC and TOD from vertical speed and groundspeed', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
    ]);

    const result = calculateVerticalProfile({
      legs,
      departureElevationFt: 0,
      destinationElevationFt: 0,
      initialPlannedAltitudeFt: 6000,
      finalPlannedAltitudeFt: 6000,
      climbRateFpm: 600,
      descentRateFpm: 600,
      climbGroundSpeedKt: 90,
      descentGroundSpeedKt: 120,
    });

    expect(result.climbTimeMin).toBeCloseTo(10, 8);
    expect(result.descentTimeMin).toBeCloseTo(10, 8);
    expect(result.climbDistanceNm).toBeCloseTo(15, 8);
    expect(result.descentDistanceNm).toBeCloseTo(20, 8);
    expect(result.tocDistanceFromDepartureNm).toBeCloseTo(15, 8);
    expect(result.todDistanceToDestinationNm).toBeCloseTo(20, 8);
    expect(result.levelDistanceNm).toBeCloseTo(result.routeDistanceNm - 35, 6);
    expect(result.profilesOverlap).toBe(false);
    expect(result.tocCoordinate).not.toBeNull();
    expect(result.todCoordinate).not.toBeNull();
  });

  it('flags routes where climb and descent profiles overlap', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 0.2),
    ]);

    const result = calculateVerticalProfile({
      legs,
      departureElevationFt: 0,
      destinationElevationFt: 0,
      initialPlannedAltitudeFt: 6000,
      finalPlannedAltitudeFt: 6000,
      climbRateFpm: 600,
      descentRateFpm: 600,
      climbGroundSpeedKt: 90,
      descentGroundSpeedKt: 120,
    });

    expect(result.profilesOverlap).toBe(true);
    expect(result.levelDistanceNm).toBe(0);
    expect(result.overlapDistanceNm).toBeGreaterThan(0);
  });

  it('places a route point at cumulative distance across multiple legs', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
      waypoint('C', 0, 2),
    ]);
    const firstLegDistance = legs[0].distanceNm;
    const point = routeCoordinateAtDistance(legs, firstLegDistance * 1.5);

    expect(point).not.toBeNull();
    expect(point?.lat).toBeCloseTo(0, 6);
    expect(point?.lon).toBeCloseTo(1.5, 5);
  });
});
