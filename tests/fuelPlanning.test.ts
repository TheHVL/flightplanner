import { describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import {
  calculateFuelPlanForStore,
  DEFAULT_FUEL_PLANNING_SETTINGS,
  type FuelPlanningSettings,
} from '../src/fuel/fuelPlanning';

function fuelSettings(patch: Partial<FuelPlanningSettings> = {}): FuelPlanningSettings {
  return { ...DEFAULT_FUEL_PLANNING_SETTINGS, ...patch };
}

function twoPointRoute(distanceDegrees = 1): { store: FlightPlanStore; fromId: string; toId: string } {
  const store = new FlightPlanStore();
  const from = store.addWaypoint({ lat: 60, lon: 10 }, 'A');
  const to = store.addWaypoint({ lat: 60 + distanceDegrees, lon: 10 }, 'B');
  return { store, fromId: from.id, toId: to.id };
}

describe('phase-aware fuel planning', () => {
  it('uses leg PL and POH Figure 5-9 cruise fuel flow for level flight', () => {
    const { store, fromId, toId } = twoPointRoute();
    store.setPlannedAltitudeFt(fromId, toId, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 4000, destinationElevationFt: 4000 });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, fuelSettings());
    const leg = plan.legs[0];

    expect(leg.pressureAltitudeFt).toBe(4000);
    expect(leg.tasKt).toBe(133);
    expect(leg.cruiseFuelFlowGph).toBe(12.1);
    expect(leg.climbTimeMin).toBe(0);
    expect(leg.descentTimeMin).toBe(0);
    expect(leg.cruiseFuelGal).toBeCloseTo(12.1 * (store.getLegs()[0].distanceNm / 133), 5);
  });

  it('uses Figure 5-8 normal-climb time, distance and fuel automatically', () => {
    const { store, fromId, toId } = twoPointRoute(2);
    store.setPlannedAltitudeFt(fromId, toId, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 0, destinationElevationFt: 4000 });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, fuelSettings({ climbPerformanceMode: 'poh-normal-90' }));
    const leg = plan.legs[0];

    expect(leg.climbTimeMin).toBeCloseTo(6, 5);
    expect(leg.climbDistanceNm).toBeCloseTo(10, 5);
    expect(leg.climbFuelGal).toBeCloseTo(1.6, 5);
    expect(plan.climbFuelGal).toBeCloseTo(1.6, 5);
  });

  it('separates manual climb, cruise and descent fuel using the vertical profile', () => {
    const { store, fromId, toId } = twoPointRoute(2);
    store.setPlannedAltitudeFt(fromId, toId, 4000);
    store.updateVerticalProfileSettings({
      departureElevationFt: 0,
      destinationElevationFt: 0,
      climbRateFpm: 1000,
      descentRateFpm: 500,
      climbGroundSpeedKt: 100,
      descentGroundSpeedKt: 120,
    });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, fuelSettings({
      climbPerformanceMode: 'manual',
      climbFuelFlowGph: 20,
      descentFuelFlowGph: 8,
    }));
    const leg = plan.legs[0];

    expect(leg.climbTimeMin).toBeCloseTo(4, 5);
    expect(leg.descentTimeMin).toBeCloseTo(8, 5);
    expect(leg.climbFuelGal).toBeCloseTo(20 * 4 / 60, 5);
    expect(leg.descentFuelGal).toBeCloseTo(8 * 8 / 60, 5);
    expect(leg.cruiseDistanceNm).toBeCloseTo(store.getLegs()[0].distanceNm - (100 * 4 / 60) - (120 * 8 / 60), 5);
    expect(plan.tripFuelGal).toBeCloseTo(
      1.7 + (leg.cruiseFuelGal ?? 0) + (leg.climbFuelGal ?? 0) + (leg.descentFuelGal ?? 0),
      5,
    );
  });

  it('adds circuit fuel to the outbound leg when circuit FF is supplied', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 60, lon: 10 }, 'A');
    const b = store.addWaypoint({ lat: 60.5, lon: 10 }, 'B');
    const c = store.addWaypoint({ lat: 61, lon: 10 }, 'C');
    store.setPlannedAltitudeFt(a.id, b.id, 4000);
    store.setPlannedAltitudeFt(b.id, c.id, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 4000, destinationElevationFt: 4000 });
    store.setWaypointVerticalConstraint(b.id, {
      mode: 'circuits',
      elevationFt: 4000,
      circuitCount: 2,
      minutesPerCircuit: 6,
    });
    store.updatePerformanceSettings({ usePohPerformance: false });

    const plan = calculateFuelPlanForStore(store, fuelSettings({
      manualCruiseFuelFlowGph: 10,
      circuitFuelFlowGph: 12,
    }));

    expect(plan.legs[0].activityTimeMin).toBe(0);
    expect(plan.legs[1].activityTimeMin).toBe(12);
    expect(plan.legs[1].circuitFuelGal).toBeCloseTo(2.4, 5);
    expect(plan.circuitFuelGal).toBeCloseTo(2.4, 5);
  });

  it('keeps trip fuel incomplete when manual climb FF is required but missing', () => {
    const { store, fromId, toId } = twoPointRoute(2);
    store.setPlannedAltitudeFt(fromId, toId, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 0, destinationElevationFt: 4000 });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, fuelSettings({ climbPerformanceMode: 'manual' }));

    expect(plan.legs[0].climbTimeMin).toBeGreaterThan(0);
    expect(plan.legs[0].climbFuelGal).toBeNull();
    expect(plan.legs[0].legFuelGal).toBeNull();
    expect(plan.tripFuelGal).toBeNull();
  });

  it('withholds complete fuel when normal-climb data is requested above its 10000 ft limit', () => {
    const { store, fromId, toId } = twoPointRoute(3);
    store.setPlannedAltitudeFt(fromId, toId, 12000);
    store.updateVerticalProfileSettings({ departureElevationFt: 0, destinationElevationFt: 12000 });
    store.updatePerformanceSettings({ oatC: -9, rpm: 2300, manifoldPressureInHg: 18, usePohPerformance: true });

    const plan = calculateFuelPlanForStore(store, fuelSettings({ climbPerformanceMode: 'poh-normal-90' }));

    expect(plan.verticalProfile?.climbPerformanceIncomplete).toBe(true);
    expect(plan.tripFuelGal).toBeNull();
    expect(plan.warnings.join(' ')).toMatch(/does not cover|only published/i);
  });

  it('uses fetched route-weather temperature for per-leg cruise performance', () => {
    const { store, fromId, toId } = twoPointRoute();
    store.setPlannedAltitudeFt(fromId, toId, 4000);
    store.updateVerticalProfileSettings({ departureElevationFt: 4000, destinationElevationFt: 4000 });
    store.updatePerformanceSettings({ oatC: 7, rpm: 2300, manifoldPressureInHg: 22, usePohPerformance: true });
    store.setRouteWeatherForecasts([{
      fromId,
      toId,
      altitudeFt: 4000,
      validTimeUtc: '2026-09-07T14:00:00.000Z',
      windFromDeg: 0,
      windSpeedKt: 0,
      temperatureC: 27,
      source: 'test forecast',
    }]);

    const plan = calculateFuelPlanForStore(store, fuelSettings());

    expect(plan.legs[0].oatSource).toBe('forecast');
    expect(plan.legs[0].oatC).toBe(27);
    expect(plan.legs[0].cruiseFuelFlowGph).toBe(11.7);
  });
});
