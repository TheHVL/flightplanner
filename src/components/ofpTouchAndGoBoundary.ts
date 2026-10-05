import type { WaypointVerticalMode } from '../flightplan/FlightPlanStore';

/**
 * The OFP uses a solid separator after an intermediate waypoint explicitly
 * selected as Airport / T&G or Airport + pattern. The separator is placed
 * after any pattern row at the airport.
 */
export function isOfpTouchAndGoBoundary(mode: WaypointVerticalMode): boolean {
  return mode === 'airport' || mode === 'circuits';
}
