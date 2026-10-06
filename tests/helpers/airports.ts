import type { FlightPlanStore } from '../../src/flightplan/FlightPlanStore';

/** Identify a synthetic airport used in calculation/layout fixtures. */
export function identifyTestAirport(store: FlightPlanStore, id: string, icao = 'ENDU'): void {
  store.updateWaypoint(id, { aipId: icao, aipEffectiveDate: '2026-09-03' });
}
