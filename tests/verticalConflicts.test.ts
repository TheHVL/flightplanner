import { describe, expect, it } from 'vitest';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import { calculateRouteVerticalProfile } from '../src/navigation/verticalProfile';
import {
  calculateVerticalProfileConflicts,
  formatVerticalConflict,
  verticalConflictAdvice,
} from '../src/navigation/verticalConflicts';
import type { Waypoint } from '../src/types';

const waypoint = (id: string, lat: number, lon: number): Waypoint => ({ id, name: id, lat, lon });

const settings = {
  departureElevationFt: 0,
  destinationElevationFt: 0,
  climbRateFpm: 600,
  descentRateFpm: 600,
  climbGroundSpeedKt: 90,
  descentGroundSpeedKt: 120,
};

describe('vertical conflict diagnostics', () => {
  it('identifies the exact TOC and TOD transitions that overlap', () => {
    const legs = calculateRouteLegs([
      waypoint('DEP', 0, 0),
      waypoint('DEST', 0, 0.25),
    ]);

    const profile = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [6000],
      waypointConstraints: [],
      ...settings,
    });

    expect(profile.profilesOverlap).toBe(true);
    const conflicts = calculateVerticalProfileConflicts(profile);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].firstEvent.type).toBe('TOC');
    expect(conflicts[0].secondEvent.type).toBe('TOD');
    expect(conflicts[0].overlapDistanceNm).toBeGreaterThan(0);
    expect(formatVerticalConflict(conflicts[0])).toContain('TOC after DEP');
    expect(formatVerticalConflict(conflicts[0])).toContain('TOD before DEST');
    expect(verticalConflictAdvice(conflicts[0])).toContain('same route section');
  });

  it('returns no conflicts for a valid profile', () => {
    const legs = calculateRouteLegs([
      waypoint('DEP', 0, 0),
      waypoint('DEST', 0, 1),
    ]);

    const profile = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [3000],
      waypointConstraints: [],
      ...settings,
    });

    expect(profile.profilesOverlap).toBe(false);
    expect(calculateVerticalProfileConflicts(profile)).toEqual([]);
  });
});
