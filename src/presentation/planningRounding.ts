/**
 * Presentation-only planning rounding.
 *
 * Internal navigation, performance and fuel calculations retain full precision.
 * These helpers implement the conservative display convention requested for the
 * OFP and planning summaries: time rounds upward to the next whole minute and
 * fuel used rounds upward to the next whole US gallon.
 */

const ROUNDING_EPSILON = 1e-9;

export function ceilPlanningMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes < 0) {
    throw new Error('Planning time must be a finite non-negative number.');
  }
  return Math.ceil(minutes - ROUNDING_EPSILON);
}

export function ceilFuelUsageGal(gallons: number): number {
  if (!Number.isFinite(gallons) || gallons < 0) {
    throw new Error('Fuel usage must be a finite non-negative number.');
  }
  return Math.ceil(gallons - ROUNDING_EPSILON);
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
