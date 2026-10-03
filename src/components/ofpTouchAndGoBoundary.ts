import type { WaypointVerticalMode } from '../flightplan/FlightPlanStore';

/**
 * The OFP uses a solid separator after an intermediate waypoint explicitly
 * selected as Airport / T&G. Other vertical-profile modes do not create a
 * sector separator.
 */
export function isOfpTouchAndGoBoundary(mode: WaypointVerticalMode): boolean {
  return mode === 'airport';
}
