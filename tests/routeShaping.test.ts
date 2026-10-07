import { describe, expect, it } from 'vitest';
import {
  calculateRouteLegs,
  densifyRoutePath,
  initialTrueTrackDeg,
  coordinateAtRouteDistance,
  greatCircleDistanceNm,
  routeLegKey,
  trackAtRouteDistance,
} from '../src/navigation/geodesy';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../src/fuel/fuelPlanning';
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


it('retains direct navigation headings while a bend increases time and fuel', () => {
  const store = new FlightPlanStore(), shapes = new RouteShapeController(store);
  const a = store.addWaypoint({ lat: 60, lon: 10 }, 'A');
  const b = store.addWaypoint({ lat: 60, lon: 12 }, 'B');
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.updateNavigationSettings({ tasKt: 120, windFromDeg: 0, windSpeedKt: 30 });
  store.updateVerticalProfileSettings({ departureElevationFt: 4000, destinationElevationFt: 4000 });
  store.setPlannedAltitudeFt(a.id, b.id, 4000);
  const fuelSettings = { ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 12 };
  const before = calculateFuelPlanForStore(store, fuelSettings);
  const directTrack = store.getLegs()[0].trueTrackDeg;
  expect(shapes.setLegShape(0, { lat: 60.5, lon: 11 })).toBe(true);
  const after = calculateFuelPlanForStore(store, fuelSettings);
  expect(store.getWaypoints().map(p => p.id)).toEqual([a.id, b.id]);
  expect(store.getLegs()).toHaveLength(1);
  expect(store.getLegs()[0].trueTrackDeg).toBe(directTrack);
  expect(after.legs[0].trueHeadingDeg).toBe(before.legs[0].trueHeadingDeg);
  expect(after.legs[0].cruiseGroundSpeedKt).toBe(before.legs[0].cruiseGroundSpeedKt);
  expect(after.legs[0].totalTimeMin).toBeGreaterThan(before.legs[0].totalTimeMin);
  expect(after.legs[0].legFuelGal).toBeGreaterThan(before.legs[0].legFuelGal!);
  expect(shapes.undoImmediateShape()).toBe(true);
  expect(calculateFuelPlanForStore(store, fuelSettings)).toEqual(before);
});

it('draws the terrain interpolation and follows its local tangent without changing OFP track', () => {
  const leg = calculateRouteLegs([wp('ENTC', 69.68138889, 18.91777778), wp('ENSR', 69.78666667, 20.95944444)])[0];
  const path = densifyRoutePath([leg.from, leg.to]);
  expect(path.length).toBeGreaterThan(100);
  path.forEach((point, i) => {
    const calculated = coordinateAtRouteDistance([leg], leg.distanceNm * i / (path.length - 1))!;
    expect(point.lat).toBeCloseTo(calculated.lat, 9);
    expect(point.lon).toBeCloseTo(calculated.lon, 9);
    if (i) expect(greatCircleDistanceNm(path[i - 1], point)).toBeLessThanOrEqual(0.100001);
  });
  const middle = coordinateAtRouteDistance([leg], leg.distanceNm / 2)!;
  expect(trackAtRouteDistance([leg], leg.distanceNm / 2)).toBeCloseTo(initialTrueTrackDeg(middle, leg.to), 9);
  expect(trackAtRouteDistance([leg], leg.distanceNm)).toBeCloseTo((initialTrueTrackDeg(leg.to, leg.from) + 180) % 360, 9);
  expect(leg.trueTrackDeg).toBe(initialTrueTrackDeg(leg.from, leg.to));
  expect(() => densifyRoutePath([leg.from, leg.to], 0)).toThrow();
});
