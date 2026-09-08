import type { RouteVerticalEvent, RouteVerticalProfileResult } from './verticalProfile';

const EPSILON = 1e-6;

export interface VerticalProfileConflict {
  id: string;
  firstEvent: RouteVerticalEvent;
  secondEvent: RouteVerticalEvent;
  startNm: number;
  endNm: number;
  overlapDistanceNm: number;
}

interface EventInterval {
  event: RouteVerticalEvent;
  startNm: number;
  endNm: number;
}

export function calculateVerticalProfileConflicts(
  profile: RouteVerticalProfileResult,
): VerticalProfileConflict[] {
  if (!profile.profilesOverlap || profile.events.length < 2) return [];

  const intervals = profile.events
    .map((event): EventInterval => {
      const rawStart = event.type === 'TOC'
        ? event.routeDistanceNm - event.distanceNm
        : event.routeDistanceNm;
      const rawEnd = event.type === 'TOC'
        ? event.routeDistanceNm
        : event.routeDistanceNm + event.distanceNm;

      return {
        event,
        startNm: clamp(Math.min(rawStart, rawEnd), 0, profile.routeDistanceNm),
        endNm: clamp(Math.max(rawStart, rawEnd), 0, profile.routeDistanceNm),
      };
    })
    .filter((interval) => interval.endNm - interval.startNm > EPSILON);

  const conflicts: VerticalProfileConflict[] = [];

  for (let firstIndex = 0; firstIndex < intervals.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < intervals.length; secondIndex += 1) {
      const first = intervals[firstIndex];
      const second = intervals[secondIndex];
      const startNm = Math.max(first.startNm, second.startNm);
      const endNm = Math.min(first.endNm, second.endNm);
      const overlapDistanceNm = endNm - startNm;
      if (overlapDistanceNm <= EPSILON) continue;

      const [firstEvent, secondEvent] = orderedConflictEvents(first.event, second.event);
      conflicts.push({
        id: `${firstEvent.id}__${secondEvent.id}`,
        firstEvent,
        secondEvent,
        startNm,
        endNm,
        overlapDistanceNm,
      });
    }
  }

  return conflicts.sort((a, b) => a.startNm - b.startNm || b.overlapDistanceNm - a.overlapDistanceNm);
}

export function formatVerticalConflict(conflict: VerticalProfileConflict): string {
  return `${formatVerticalEvent(conflict.firstEvent)} overlaps ${formatVerticalEvent(conflict.secondEvent)} by ${halfNm(conflict.overlapDistanceNm)} NM.`;
}

export function verticalConflictAdvice(conflict: VerticalProfileConflict): string {
  const types = new Set([conflict.firstEvent.type, conflict.secondEvent.type]);
  if (types.size === 2) {
    return 'The climb and descent require the same route section. Review the planned level, descent rate/TAS, climb selection, airport constraint, or available route distance.';
  }
  if (conflict.firstEvent.type === 'TOC') {
    return 'Two climb profiles require the same route section. Review successive PL increases, airport constraints, or the selected climb performance.';
  }
  return 'Two descent profiles require the same route section. Review successive PL reductions, airport constraints, descent rate/TAS, or available route distance.';
}

export function formatVerticalEvent(event: RouteVerticalEvent): string {
  const location = `${event.type} ${event.position} ${event.waypointName}`;
  return `${location} (${Math.round(event.altitudeFromFt).toLocaleString()} → ${Math.round(event.altitudeToFt).toLocaleString()} ft)`;
}

function orderedConflictEvents(
  first: RouteVerticalEvent,
  second: RouteVerticalEvent,
): [RouteVerticalEvent, RouteVerticalEvent] {
  if (first.type === second.type) return [first, second];
  return first.type === 'TOC' ? [first, second] : [second, first];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function halfNm(value: number): string {
  return (Math.round(value * 2) / 2).toFixed(1);
}
