/**
 * Presentation-only planning rounding.
 *
 * Internal navigation, performance and fuel calculations retain full precision.
 * These helpers implement the display convention requested for the
 * OFP and planning summaries: time rounds upward to the next whole minute,
 * fuel used rounds upward to the next whole US gallon. Leg distance rounds
 * down when its fractional part is below 0.3 NM, otherwise up. ACC and total
 * distance add these displayed whole-NM leg values.
 */

const ROUNDING_EPSILON = 1e-9;

export function ceilPlanningMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('Planning time must be a finite non-negative number.');
  }
  if (minutes <= ROUNDING_EPSILON) return 0;
  return Math.ceil(minutes - ROUNDING_EPSILON);
}

export function ceilFuelUsageGal(gallons: number): number {
  if (!Number.isFinite(gallons) || gallons < 0) {
    throw new Error('Fuel usage must be a finite non-negative number.');
  }
  if (gallons <= ROUNDING_EPSILON) return 0;
  return Math.ceil(gallons - ROUNDING_EPSILON);
}

export function roundLegDistanceNm(distanceNm: number): number {
  if (!Number.isFinite(distanceNm) || distanceNm < 0) {
    throw new Error('Leg distance must be a finite non-negative number.');
  }
  const wholeNm = Math.floor(distanceNm);
  return wholeNm + (distanceNm - wholeNm >= 0.3 - ROUNDING_EPSILON ? 1 : 0);
}

export function formatPlanningTime(minutes: number): string {
  const totalMinutes = ceilPlanningMinutes(minutes);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${String(mins).padStart(2, '0')}`;
}

export function formatPlanningMinutesLabel(minutes: number): string {
  return `${ceilPlanningMinutes(minutes)} min`;
}
