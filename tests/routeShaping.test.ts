import { describe, expect, it } from 'vitest';
import {
  calculateRouteLegs,
  coordinateAtRouteDistance,
  greatCircleDistanceNm,
  routeLegKey,
  trackAtRouteDistance,
} from '../src/navigation/geodesy';
import type { Waypoint } from '../src/types';

const wp = (id: string, lat: number, lon: number): Waypoint => ({ id, name: id, lat, lon });

describe('distance-only route shaping', () => {
  it('adds flown distance without changing direct waypoint true track', () => {
    const a = wp('A', 60, 10);
    const b = wp('B', 60, 12);
    const direct = calculateRouteLegs([a, b])[0];
    const shapes = new Map([[routeLegKey(a.id, b.id), { lat: 60.5, lon: 11 }]]);
    const shaped = calculateRouteLegs([a, b], shapes)[0];

    expect(shaped.trueTrackDeg).toBeCloseTo(direct.trueTrackDeg, 10);
    expect(shaped.directDistanceNm).toBeCloseTo(direct.distanceNm, 10);
    expect(shaped.distanceNm).toBeGreaterThan(direct.distanceNm);
    expect(shaped.path).toHaveLength(3);
  });

  it('locates cumulative route positions on the shaped path', () => {
    const a = wp('A', 60, 10);
    const b = wp('B', 60, 12);
    const bend = { lat: 60.5, lon: 11 };
    const shapes = new Map([[routeLegKey(a.id, b.id), bend]]);
    const leg = calculateRouteLegs([a, b], shapes)[0];
    const distanceToBend = greatCircleDistanceNm(a, bend);

    const point = coordinateAtRouteDistance([leg], distanceToBend);
    expect(point?.lat).toBeCloseTo(bend.lat, 6);
    expect(point?.lon).toBeCloseTo(bend.lon, 6);
    expect(trackAtRouteDistance([leg], distanceToBend / 2)).not.toBeCloseTo(leg.trueTrackDeg, 3);
  });
});
