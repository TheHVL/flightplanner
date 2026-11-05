import { FlightPlanStore } from '../../src/flightplan/FlightPlanStore';
import { DEFAULT_FUEL_PLANNING_SETTINGS } from '../../src/fuel/fuelPlanning';
import { identifyTestAirport } from './airports';

/** Synthetic stops too close for their requested climb/descent, with valid legs on both sides. */
export function overlappingProfileRoute() {
  const store = new FlightPlanStore(3000);
  [0, 0.5, 1.5, 1.55, 2.55, 3.05].forEach((lon, i) => store.addWaypoint({ lat: 0, lon }, `WP${i + 1}`));
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.updateNavigationSettings({ tasKt: 120, windSpeedKt: 0 });
  store.updateVerticalProfileSettings({ departureElevationFt: 3000, destinationElevationFt: 3000,
    climbRateFpm: 500, descentRateFpm: 500, climbGroundSpeedKt: 90, descentGroundSpeedKt: 120 });
  for (const point of store.getWaypoints().slice(2, 4)) {
    identifyTestAirport(store, point.id);
    store.setWaypointVerticalConstraint(point.id, { mode: 'airport', elevationFt: 0 });
  }
  const fuelSettings = { ...DEFAULT_FUEL_PLANNING_SETTINGS, climbPerformanceMode: 'manual' as const,
    manualCruiseFuelFlowGph: 12, climbFuelFlowGph: 12, descentFuelFlowGph: 12,
    totalFuelOnboardGal: 50, circuitFuelFlowGph: 12 };
  return { store, fuelSettings };
}
