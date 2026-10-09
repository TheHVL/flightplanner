import type { RouteLeg, Waypoint } from '../types';

// Avoid red/amber, which identify route-review conflicts and incomplete checks.
export const ROUTE_SECTOR_COLORS = ['#2563eb', '#7c3aed', '#0f766e', '#be185d', '#075985', '#475569'] as const;

export interface RouteSector {
  index: number;
  color: string;
  legs: RouteLeg[];
}

/** Arrival at an identified airport ends a sector; its outbound legs use the next color. */
export function airportRouteSectors(legs: RouteLeg[], isAirport: (point: Waypoint) => boolean = point =>
  /^EN[A-Z]{2}$/.test(point.aipId ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(point.aipEffectiveDate ?? '')): RouteSector[] {
  const sectors: RouteSector[] = [];
  for (const leg of legs) {
    const previous = sectors.at(-1);
    if (!previous || isAirport(leg.from)) {
      const index = sectors.length;
      sectors.push({ index, color: ROUTE_SECTOR_COLORS[index % ROUTE_SECTOR_COLORS.length], legs: [leg] });
    } else previous.legs.push(leg);
  }
  return sectors;
}
