import type { PublishedRestriction, RadioArea, RadioCatalog, RadioVolume } from '../frequencies/catalog';
import { polygonContains, segmentCrossings } from './geometry';
import { coordinateAtRouteDistance, greatCircleDistanceNm, routeLegPath } from '../navigation/geodesy';
import type { RouteLeg } from '../types';

export interface AirspaceEncounter {
  area: RadioArea | PublishedRestriction;
  legIndex: number;
  volume: RadioVolume;
  startNm: number;
  endNm: number;
  relation: 'intersects' | 'below' | 'above' | 'review';
}
const EPS = 1e-8;
function relation(volume: RadioVolume, altitude: number | null, uncertain: boolean): AirspaceEncounter['relation'] {
  if (uncertain || altitude === null || !Number.isFinite(altitude) || [volume.lower, volume.upper].some(l => ['AGL', 'FL'].includes(l.reference))) return 'review';
  if (altitude < (volume.lower.value ?? 0)) return 'below';
  if (volume.upper.reference !== 'UNL' && altitude >= (volume.upper.value ?? Infinity)) return 'above';
  return 'intersects';
}

/** Terminal airspace footprint and vertical relation. ATS sectors are not airspace restrictions.
 * Split at bends, polygon boundaries and AMSL level crossings. No QNH/FL inference.
 */
export function reviewLegAirspace(leg: RouteLeg, catalog: RadioCatalog, altitudeAt: (distanceNm: number) => number | null, altitudeBreaks: number[] = []): AirspaceEncounter[] {
  if (leg.distanceNm <= EPS) return [];
  const checkpoints = [0, leg.distanceNm, ...altitudeBreaks.filter(n => n > 0 && n < leg.distanceNm)];
  const steps = Math.ceil(leg.distanceNm / 0.5);
  for (let i = 1; i < steps; i++) checkpoints.push(i * leg.distanceNm / steps);
  const path = routeLegPath(leg); let along = 0;
  for (let i = 1; i < path.length - 1; i++) { along += greatCircleDistanceNm(path[i - 1], path[i]); checkpoints.push(along); }
  const positions = [...new Set(checkpoints)].sort((a, b) => a - b);
  const results: AirspaceEncounter[] = [];
  for (const area of [...catalog.airspaces.filter(a => a.type.toLowerCase() !== 'sector'), ...(catalog.restrictions ?? [])]) for (const volume of area.volumes) {
    let previous: AirspaceEncounter | undefined;
    for (let i = 1; i < positions.length; i++) {
      const start = positions[i - 1], end = positions[i];
      const a = coordinateAtRouteDistance([leg], start)!, b = coordinateAtRouteDistance([leg], end)!;
      const fractions = [0, 1];
      for (let n = 1; n < volume.polygon.length; n++) {
        fractions.push(...segmentCrossings([a.lon, a.lat], [b.lon, b.lat], volume.polygon[n - 1], volume.polygon[n]));
      }
      const altA = altitudeAt(start), altB = altitudeAt(end);
      if (altA !== null && altB !== null && Math.abs(altA - altB) > EPS) for (const limit of [volume.lower, volume.upper]) {
        if (limit.reference !== 'AMSL' || limit.value === null) continue;
        const t = (limit.value - altA) / (altB - altA); if (t > EPS && t < 1 - EPS) fractions.push(t);
      }
      const cuts = [...new Set(fractions)].sort((a, b) => a - b);
      for (let n = 1; n < cuts.length; n++) {
        const x = start + cuts[n - 1] * (end - start), y = start + cuts[n] * (end - start);
        if (y - x < 1e-6) continue;
        const middle = (x + y) / 2, point = coordinateAtRouteDistance([leg], middle)!;
        if (!polygonContains([point.lon, point.lat], volume.polygon)) { previous = undefined; continue; }
        const state = relation(volume, altitudeAt(middle), !!area.unresolvedGeometry || 'verticalLimitsUnknown' in area && !!area.verticalLimitsUnknown);
        if (previous && previous.relation === state && Math.abs(previous.endNm - x) < 1e-6) previous.endNm = y;
        else { previous = { area, volume, legIndex: leg.index, startNm: x, endNm: y, relation: state }; results.push(previous); }
      }
    }
  }
  return results.sort((a, b) => a.startNm - b.startNm || a.area.name.localeCompare(b.area.name));
}
