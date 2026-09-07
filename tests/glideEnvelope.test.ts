import { describe, expect, it } from 'vitest';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import {
  buildC182TGlideEnvelopeSamples,
  modeledAltitudeFtAtRouteDistance,
} from '../src/navigation/glideEnvelope';
import { calculateRouteVerticalProfile } from '../src/navigation/verticalProfile';
import type { Waypoint } from '../src/types';

function waypoint(id: string, lon: number): Waypoint {
  return { id, name: id, lat: 0, lon };
}

describe('C182T glide envelope', () => {
  it('uses the planned level where the route is level', () => {
    const legs = calculateRouteLegs([waypoint('A', 0), waypoint('B', 0.1665)]);
    const profile = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [7000],
      waypointConstraints: [],
      departureElevationFt: 7000,
      destinationElevationFt: 7000,
      climbRateFpm: 700,
      descentRateFpm: 500,
      climbGroundSpeedKt: 90,
      descentGroundSpeedKt: 120,
    });

    const result = buildC182TGlideEnvelopeSamples({
      legs,
      plannedAltitudesFt: [7000],
      verticalProfile: profile,
      sampleSpacingNm: 2,
    });

    expect(result.samples.length).toBeGreaterThan(2);
    expect(result.samples.every((sample) => Math.abs(sample.glideRangeNm - 10) < 1e-8)).toBe(true);
    expect(result.maxRangeNm).toBeCloseTo(10, 8);
  });

  it('uses the modeled climb altitude instead of optimistically using PL before TOC', () => {
    const legs = calculateRouteLegs([waypoint('A', 0), waypoint('B', 0.333)]);
    const profile = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [7000],
      waypointConstraints: [],
      departureElevationFt: 0,
      destinationElevationFt: 7000,
      climbRateFpm: 700,
      descentRateFpm: 500,
      climbGroundSpeedKt: 60,
      descentGroundSpeedKt: 120,
    });

    const altitudeHalfwayThroughClimb = modeledAltitudeFtAtRouteDistance(
      legs,
      [7000],
      profile.events,
      5,
    );

    expect(profile.events[0].type).toBe('TOC');
    expect(profile.events[0].distanceNm).toBeCloseTo(10, 8);
    expect(altitudeHalfwayThroughClimb).toBeCloseTo(3500, 6);
  });

  it('hides the envelope when climb and descent profiles overlap', () => {
    const legs = calculateRouteLegs([waypoint('A', 0), waypoint('B', 0.1665)]);
    const profile = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [7000],
      waypointConstraints: [],
      departureElevationFt: 0,
      destinationElevationFt: 0,
      climbRateFpm: 700,
      descentRateFpm: 700,
      climbGroundSpeedKt: 60,
      descentGroundSpeedKt: 60,
    });

    const result = buildC182TGlideEnvelopeSamples({
      legs,
      plannedAltitudesFt: [7000],
      verticalProfile: profile,
    });

    expect(profile.profilesOverlap).toBe(true);
    expect(result.samples).toEqual([]);
    expect(result.warnings[0]).toMatch(/overlapping/i);
  });
});
