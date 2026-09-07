import { describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../src/fuel/fuelPlanning';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import { calculateRouteVerticalProfile } from '../src/navigation/verticalProfile';
import type { Waypoint } from '../src/types';

const waypoint = (id: string, lat: number, lon: number): Waypoint => ({ id, name: id, lat, lon });

const baseVerticalSettings = {
  departureElevationFt: 0,
  destinationElevationFt: 4000,
  climbRateFpm: 700,
  descentRateFpm: 500,
  climbGroundSpeedKt: 90,
  descentGroundSpeedKt: 120,
};

describe('phase-specific TAS and wind-aware vertical geometry', () => {
  it('keeps POH climb time/fuel but moves TOC with headwind and tailwind', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
    ]);

    const calculate = (windFromDeg: number) => calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [4000],
      waypointConstraints: [],
      ...baseVerticalSettings,
      climbPerformanceMode: 'poh-normal-90',
      climbOatC: 7,
      legWinds: [{ windFromDeg, windSpeedKt: 25 }],
      legOatC: [7],
    });

    const headwind = calculate(90);
    const tailwind = calculate(270);
    const headwindToc = headwind.events.find((event) => event.type === 'TOC');
    const tailwindToc = tailwind.events.find((event) => event.type === 'TOC');

    expect(headwindToc).toBeDefined();
    expect(tailwindToc).toBeDefined();
    expect(headwindToc?.timeMin).toBeCloseTo(6, 8);
    expect(headwindToc?.fuelGal).toBeCloseTo(1.6, 8);
    expect(headwindToc?.zeroWindDistanceNm).toBeCloseTo(10, 8);
    expect(headwindToc?.phaseTasKt).toBeCloseTo(100, 8);
    expect(headwindToc?.distanceNm).toBeCloseTo(7.5, 5);
    expect(tailwindToc?.timeMin).toBeCloseTo(6, 8);
    expect(tailwindToc?.fuelGal).toBeCloseTo(1.6, 8);
    expect(tailwindToc?.distanceNm).toBeCloseTo(12.5, 5);
  });

  it('uses descent TAS and wind to position TOD', () => {
    const legs = calculateRouteLegs([
      waypoint('A', 0, 0),
      waypoint('B', 0, 1),
    ]);

    const result = calculateRouteVerticalProfile({
      legs,
      plannedAltitudesFt: [4000],
      waypointConstraints: [],
      ...baseVerticalSettings,
      departureElevationFt: 4000,
      destinationElevationFt: 0,
      legWinds: [{ windFromDeg: 90, windSpeedKt: 20 }],
    });
    const tod = result.events.find((event) => event.type === 'TOD' && event.reason === 'arrival');

    expect(tod).toBeDefined();
    expect(tod?.timeMin).toBeCloseTo(8, 8);
    expect(tod?.phaseTasKt).toBe(120);
    expect(tod?.distanceNm).toBeCloseTo(100 * 8 / 60, 5);
  });

  it('uses enabled forecast wind for the vertical profile and manual wind as fallback', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 60, lon: 10 }, 'A');
    const b = store.addWaypoint({ lat: 60, lon: 11 }, 'B');
    store.updateNavigationSettings({ windFromDeg: 180, windSpeedKt: 8 });
    store.setRouteWeatherForecasts([{
      fromId: a.id,
      toId: b.id,
      altitudeFt: 4000,
      validTimeUtc: '2026-09-07T14:00:00.000Z',
      windFromDeg: 225,
      windSpeedKt: 24,
      temperatureC: 2,
      source: 'test forecast',
    }]);

    store.updateWeatherSettings({ useForecastWinds: true });
    let vertical = store.getVerticalProfileSettings();
    expect(vertical.legWinds?.[0]).toEqual({ windFromDeg: 225, windSpeedKt: 24 });
    expect(vertical.legOatC?.[0]).toBe(2);

    store.updateWeatherSettings({ useForecastWinds: false });
    vertical = store.getVerticalProfileSettings();
    expect(vertical.legWinds?.[0]).toEqual({ windFromDeg: 180, windSpeedKt: 8 });
    expect(vertical.legOatC?.[0]).toBe(2);
  });

  it('shows climb TAS on an all-climb leg and reports whole-leg effective GS', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 0, lon: 0 }, 'A');
    const b = store.addWaypoint({ lat: 0, lon: 0.125 }, 'B');
    store.setPlannedAltitudeFt(a.id, b.id, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 0, destinationElevationFt: 4000 });
    store.updateNavigationSettings({ windFromDeg: 90, windSpeedKt: 25 });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, {
      ...DEFAULT_FUEL_PLANNING_SETTINGS,
      climbPerformanceMode: 'poh-normal-90',
    });
    const leg = plan.legs[0];

    expect(leg.displayPhase).toBe('climb');
    expect(leg.tasKt).toBeCloseTo(100, 5);
    expect(leg.climbTasKt).toBeCloseTo(100, 5);
    expect(leg.cruiseTasKt).toBeCloseTo(133, 5);
    expect(leg.groundSpeedKt).toBeCloseTo(75, 0);
    expect(leg.climbTimeMin).toBeCloseTo(6, 5);
    expect(leg.climbFuelGal).toBeCloseTo(1.6, 5);
  });
});