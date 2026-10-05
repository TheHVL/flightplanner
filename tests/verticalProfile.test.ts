import { describe, expect, it } from 'vitest';
import { modeledAltitudeFtAtRouteDistance } from '../src/navigation/glideEnvelope';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import {
  calculateRouteVerticalProfile,
  calculateVerticalProfile,
  routeCoordinateAtDistance,
} from '../src/navigation/verticalProfile';
import type { Waypoint } from '../src/types';

const waypoint = (id: string, lat: number, lon: number): Waypoint => ({ id, name: id, lat, lon });

const automaticSettings = {
  departureElevationFt: 0,
  destinationElevationFt: 0,
  climbRateFpm: 600,
  descentRateFpm: 500,
  climbGroundSpeedKt: 60,
  descentGroundSpeedKt: 60,
};

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

  it('automatically creates transitions whenever successive PL values go up or down', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
      waypoint('C', 0, 2),
      waypoint('D', 0, 3),
    ]);

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [3000, 6000, 4000],
      waypointConstraints: [],
      ...automaticSettings,
    });

    const eventKeys = result.events.map((event) => [event.type, event.reason, event.waypointName]);
    expect(eventKeys).toHaveLength(4);
    expect(eventKeys).toEqual(expect.arrayContaining([
      ['TOC', 'departure', 'A'],
      ['TOC', 'pl-change', 'B'],
      ['TOD', 'pl-change', 'C'],
      ['TOD', 'arrival', 'D'],
    ]));

    const climbAtB = result.events.find((event) => event.type === 'TOC' && event.waypointName === 'B');
    const descentAtC = result.events.find((event) => event.type === 'TOD' && event.reason === 'pl-change' && event.waypointName === 'C');
    expect(climbAtB?.distanceFromWaypointNm).toBeCloseTo(5, 8);
    expect(descentAtC?.position).toBe('before');
    expect(descentAtC?.routeDistanceNm).toBeLessThan(
      legs[0].distanceNm + legs[1].distanceNm,
    );
  });

  it('warns when reaching the lower PL would require descending before the plotted route starts', () => {
    const legs = calculateRouteLegs([
      waypoint('WP02', 0, 0),
      waypoint('WP03', 0, 1),
      waypoint('WP04', 0, 2),
    ]);
    const wp03DistanceNm = legs[0].distanceNm;

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [2500, 500],
      waypointConstraints: [],
      departureElevationFt: 2500,
      destinationElevationFt: 500,
      climbRateFpm: 600,
      descentRateFpm: 100,
      climbGroundSpeedKt: 60,
      descentGroundSpeedKt: 200,
    });

    const plTod = result.events.find((event) => event.type === 'TOD' && event.reason === 'pl-change');
    expect(plTod).toBeDefined();
    expect(plTod?.waypointName).toBe('WP03');
    expect(plTod?.position).toBe('before');
    expect(plTod!.routeDistanceNm + plTod!.distanceNm).toBeCloseTo(wp03DistanceNm, 8);
    expect(plTod?.routeDistanceNm).toBeLessThan(0);
    expect(result.warnings.some((warning) => warning.includes('before the plotted route starts'))).toBe(true);
  });

  it('reaches a low arrival level before Berg and avoids an overlap with the airport pattern visit', () => {
    const legs = calculateRouteLegs([
      waypoint('ENDU', 69.05576, 18.54036),
      waypoint('Berg', 69.60, 19.15),
      waypoint('Breivika', 69.67, 18.98),
      waypoint('ENTC', 69.68333, 18.91892),
      waypoint('ENDU-return', 69.05576, 18.54036),
    ]);
    const result = calculateRouteVerticalProfile({
      legs, plannedAltitudesFt: [4500, 1000, 1000, 4500],
      waypointConstraints: [{ waypointId: 'ENTC', mode: 'circuits', elevationFt: 31 }],
      ...automaticSettings, departureElevationFt: 252, destinationElevationFt: 252,
      climbGroundSpeedKt: 90, descentGroundSpeedKt: 120,
    });
    const entry = result.events.find(event => event.reason === 'pl-change' && event.waypointName === 'Berg')!;
    const arrival = result.events.find(event => event.reason === 'airport' && event.type === 'TOD')!;
    expect(entry.altitudeToFt).toBe(1000);
    expect(entry.routeDistanceNm + entry.distanceNm).toBeCloseTo(legs[0].distanceNm, 6);
    expect(arrival.altitudeFromFt).toBe(1000);
    expect(arrival.altitudeToFt).toBe(31);
    expect(arrival.routeDistanceNm).toBeGreaterThan(entry.routeDistanceNm + entry.distanceNm);
    expect(result.profilesOverlap).toBe(false);
    const airportDistance = legs.slice(0, 3).reduce((sum, leg) => sum + leg.distanceNm, 0);
    for (let distance = legs[0].distanceNm; distance < airportDistance; distance += 0.1) {
      expect(modeledAltitudeFtAtRouteDistance(legs, [4500, 1000, 1000, 4500], result.events, distance)).toBeLessThanOrEqual(1000);
    }
  });

  it('creates both TOD and TOC around an intermediate airport touch-and-go', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
      waypoint('C', 0, 2),
    ]);

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [5000, 5000],
      waypointConstraints: [{ waypointId: 'B', mode: 'airport', elevationFt: 500 }],
      ...automaticSettings,
    });

    const airportEvents = result.events.filter((event) => event.reason === 'airport');
    expect(airportEvents).toHaveLength(2);
    expect(airportEvents.map((event) => event.type)).toEqual(['TOD', 'TOC']);
    expect(airportEvents[0].waypointName).toBe('B');
    expect(airportEvents[0].distanceFromWaypointNm).toBeCloseTo(9, 8);
    expect(airportEvents[1].distanceFromWaypointNm).toBeCloseTo(7.5, 8);
  });

  it('treats circuit airports as airport vertical constraints', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
      waypoint('C', 0, 2),
    ]);

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [4000, 4000],
      waypointConstraints: [{ waypointId: 'B', mode: 'circuits', elevationFt: 500 }],
      ...automaticSettings,
    });

    expect(result.events.filter((event) => event.reason === 'airport').map((event) => event.type)).toEqual(['TOD', 'TOC']);
  });

  it('does not create a zero-distance TOD marker at the final waypoint', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
    ]);

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [1000],
      waypointConstraints: [],
      ...automaticSettings,
      destinationElevationFt: 1000,
    });

    expect(result.events.some((event) => event.reason === 'arrival')).toBe(false);
    expect(result.events.map((event) => event.type)).toEqual(['TOC']);
  });
});
