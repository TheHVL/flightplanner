import type { RouteLeg } from '../types';
import type { AirspaceEncounter } from './airspace';
import type { TerrainReview } from './terrain';
import { coordinateAtRouteDistance, greatCircleDistanceNm } from '../navigation/geodesy';
import { calculateVerticalProfileConflicts, formatVerticalConflict, verticalConflictAdvice } from '../navigation/verticalConflicts';
import type { RouteVerticalProfileResult } from '../navigation/verticalProfile';

export interface RouteIssue {
  id: string; severity: 'conflict' | 'incomplete' | 'review'; category: 'terrain' | 'profile' | 'airspace' | 'coverage';
  title: string; detail: string; action: string; blocksTransfer: boolean;
  legIndex?: number; startNm?: number; endNm?: number; sourceUrl?: string;
  focus?: 'pl' | 'msa' | 'frequency' | 'waypoint' | 'profile';
  requiredReviewAltitudeFt?: number;
}
export interface RasterLegIssue {
  legIndex: number; startNm: number; endNm: number; highestFt: number | null; altitudeFt: number | null;
  conflicts: number; missing: number;
}
const ft = (value: number) => `${Math.round(value)} ft`;
export const issueSeverityLabel = (severity: RouteIssue['severity']) => ({ conflict: 'Conflict', incomplete: 'Incomplete check', review: 'Review required' })[severity];
export function issueRouteCoordinates(issue: RouteIssue, legs: RouteLeg[]) {
  const leg = legs.find(l => l.index === issue.legIndex); if (!leg) return [];
  const start = Math.max(0, Math.min(leg.distanceNm, issue.startNm ?? 0));
  const end = Math.max(start, Math.min(leg.distanceNm, issue.endNm ?? leg.distanceNm));
  const steps = Math.max(1, Math.ceil((end - start) / 0.2));
  return Array.from({ length: steps + 1 }, (_, i) => coordinateAtRouteDistance([leg], start + (end - start) * i / steps)!);
}
export function sortRouteIssues(issues: RouteIssue[]): RouteIssue[] {
  const order = { conflict: 0, incomplete: 1, review: 2 };
  return issues.sort((a, b) => order[a.severity] - order[b.severity] || (a.legIndex ?? -1) - (b.legIndex ?? -1));
}
export function terrainRouteIssues(terrain: TerrainReview, legs: RouteLeg[], airports: Array<{ lat: number; lon: number }> = []): RouteIssue[] {
  const issues: RouteIssue[] = [];
  for (const leg of legs) {
    const entries = terrain.probes.flatMap((probe, i) => probe.legIndex === leg.index ? [{ probe, height: terrain.heights[i] }] : []);
    const missing = entries.filter(entry => !entry.height);
    if (missing.length) issues.push({ id: `terrain-missing-${leg.index}`, severity: 'incomplete', category: 'terrain', blocksTransfer: true,
      legIndex: leg.index, startNm: missing[0].probe.distanceNm, endNm: missing.at(-1)!.probe.distanceNm, title: 'Terrain heights missing',
      detail: `${missing.length} of ${entries.length} requested heights on this leg were not returned. Altitude clearance is unknown at those locations.`,
      action: 'Run the check again. If coverage stays missing, review the official chart and another routing; increasing PL does not fill a data gap.', sourceUrl: terrain.sourceUrl });
    const unknown = entries.filter(entry => entry.probe.altitudeFt === null || !Number.isFinite(entry.probe.altitudeFt));
    if (unknown.length) issues.push({ id: `terrain-altitude-${leg.index}`, severity: 'incomplete', category: 'profile', blocksTransfer: true,
      legIndex: leg.index, title: 'Modeled altitude unavailable', detail: `${unknown.length} sample positions cannot be compared with a valid flight altitude.`,
      action: 'Enter the leg’s planned level and resolve the climb/descent profile, then run the check again.', focus: 'pl' });
    const low = entries.filter(entry => entry.height && entry.probe.altitudeFt !== null && Number.isFinite(entry.probe.altitudeFt) && entry.probe.altitudeFt - entry.height.elevationFt < 500);
    for (const terminal of [false, true]) {
      const samples = low.filter(entry => airports.some(a => greatCircleDistanceNm(a, entry.probe) <= 3) === terminal);
      if (!samples.length) continue;
      const worst = samples.reduce((a, b) => a.probe.altitudeFt! - a.height!.elevationFt <= b.probe.altitudeFt! - b.height!.elevationFt ? a : b);
      const margin = worst.probe.altitudeFt! - worst.height!.elevationFt;
      issues.push({ id: `terrain-${terminal ? 'airport' : 'transit'}-${leg.index}`, severity: terminal ? 'review' : 'conflict', category: 'terrain', blocksTransfer: !terminal,
        legIndex: leg.index, startNm: Math.max(0, worst.probe.distanceNm - 0.25), endNm: Math.min(leg.distanceNm, worst.probe.distanceNm + 0.25),
        requiredReviewAltitudeFt: Math.ceil((worst.height!.elevationFt + 500) / 100) * 100,
        title: terminal ? 'Airport-area terrain needs review' : 'Sampled terrain margin below 500 ft',
        detail: `${samples.length} low-margin samples. Worst returned sample: modeled altitude ${ft(worst.probe.altitudeFt!)}, surface ${ft(worst.height!.elevationFt)}, margin ${ft(margin)} at ${worst.probe.distanceNm.toFixed(1)} NM along this leg, ${Math.abs(worst.probe.offsetNm).toFixed(1)} NM ${worst.probe.offsetNm === 0 ? 'on the route' : worst.probe.offsetNm > 0 ? 'right of the route' : 'left of the route'}.`,
        action: terminal ? 'Review the published departure/arrival track and airport terrain. These samples are reported separately, not verified as an approach corridor.' :
          'Review a different path or a feasible higher altitude within published limits. The sampled 500 ft reference does not establish operational MSA.', focus: 'pl', sourceUrl: terrain.sourceUrl });
    }
  }
  return issues;
}
export function applyPublishedMax(issues: RouteIssue[], capAt: (legIndex: number) => number | null): RouteIssue[] {
  return issues.map(issue => {
    const cap = issue.legIndex === undefined ? null : capAt(issue.legIndex);
    if (issue.category !== 'terrain' || issue.severity !== 'conflict' || cap === null || issue.requiredReviewAltitudeFt === undefined || issue.requiredReviewAltitudeFt <= cap) return issue;
    return { ...issue, title: 'Terrain review margin conflicts with published MAX',
      detail: `${issue.detail} The sampled review level would be at least ${ft(issue.requiredReviewAltitudeFt)}, above the published MAX ${ft(cap)}.`,
      action: 'Raising preferred altitude cannot override this MAX. Review the actual chart track or choose another entry/exit route.' };
  });
}
export function rasterRouteIssues(summaries: RasterLegIssue[], legs: RouteLeg[], capAt: (leg: RouteLeg) => number | null): RouteIssue[] {
  return summaries.flatMap(summary => {
    const leg = legs.find(l => l.index === summary.legIndex); if (!leg) return [];
    const issues: RouteIssue[] = [];
    if (summary.conflicts && summary.highestFt !== null && summary.altitudeFt !== null) {
      const cap = capAt(leg), required = Math.ceil((summary.highestFt + 500) / 100) * 100;
      const limited = cap !== null && required > cap;
      issues.push({ id: `raster-${leg.index}`, severity: 'conflict', category: 'terrain', blocksTransfer: true, legIndex: leg.index, startNm: summary.startNm, endNm: summary.endNm,
        title: limited ? 'Terrain review margin conflicts with published MAX' : 'Coarse terrain corridor conflicts with altitude',
        detail: `${summary.conflicts} corridor sections fail the 500 ft review reference. Controlling returned raster section: ${ft(summary.highestFt)} surface, ${ft(summary.altitudeFt)} modeled altitude.${limited ? ` Its sampled review level would be at least ${ft(required)}, above the published MAX ${ft(cap!)}.` : ''}`,
        action: limited ? 'Raising preferred altitude cannot override this MAX. Review the actual chart track or choose another entry/exit route.' : 'Review the plotted path and climb/descent altitude. Try a different routing or a feasible higher preferred altitude, then generate again.', focus: 'pl' });
    }
    if (summary.missing) issues.push({ id: `raster-missing-${leg.index}`, severity: 'incomplete', category: 'terrain', blocksTransfer: true, legIndex: leg.index,
      title: 'Coarse terrain/profile coverage incomplete', detail: `${summary.missing} corridor sections lack returned terrain or a valid modeled altitude.`,
      action: 'Resolve profile issues and generate again. An unknown section is not a terrain clearance result.' });
    return issues;
  });
}
export function airspaceRouteIssues(encounters: AirspaceEncounter[]): RouteIssue[] {
  return encounters.filter(encounter => ['intersects', 'review'].includes(encounter.relation)).map((encounter, index) => {
    const restriction = ['P', 'R', 'D'].includes(encounter.area.type), uncertain = encounter.relation === 'review';
    const controlled = ['CTR', 'TMA', 'CTA', 'ATZ'].includes(encounter.area.type);
    const reasons = [encounter.area.unresolvedGeometry ? 'Geometry uses a conservative review footprint or contains unresolved published boundaries.' : '',
      'verticalLimitsUnknown' in encounter.area && encounter.area.verticalLimitsUnknown ? 'Published vertical limits need publication/NOTAM review.' : '',
      [encounter.volume.lower, encounter.volume.upper].some(limit => ['FL', 'AGL'].includes(limit.reference)) ? 'FL/AGL limits cannot be converted with the current pressure/ground-reference model.' : ''].filter(Boolean);
    return { id: `airspace-${encounter.legIndex}-${index}`, severity: restriction ? uncertain ? 'incomplete' : 'conflict' : 'review', category: 'airspace',
      blocksTransfer: restriction, legIndex: encounter.legIndex, startNm: encounter.startNm, endNm: encounter.endNm, sourceUrl: encounter.area.sourceUrl,
      title: `${encounter.area.name}: ${restriction ? uncertain ? 'restriction footprint needs review' : 'published restriction footprint crossed' : uncertain ? 'vertical boundary unresolved' : 'airspace encounter'}`,
      detail: `${encounter.startNm.toFixed(1)}–${encounter.endNm.toFixed(1)} NM along this leg · ${encounter.volume.publishedLimits}.${uncertain ? ` ${reasons.join(' ') || 'A valid modeled altitude is unavailable for this section.'}` : ''}${restriction ? ' Activation is unknown; this is not a claim that the area is currently active.' : ''}`,
      action: restriction ? 'Choose a route outside the footprint. Check the published conditions and current NOTAM/activation with ATS; this generator does not authorize entry.' :
        controlled ? 'Open the published source and review the boundary, altitude and required ATC clearance. A suggested radio frequency is not a clearance.' : 'Open the published source and confirm the applicable service, reporting requirements and vertical limits.', focus: 'frequency' };
  });
}
export function profileRouteIssues(profile: RouteVerticalProfileResult, legs: RouteLeg[]): RouteIssue[] {
  const offsets: number[] = []; let total = 0;
  legs.forEach(leg => { offsets[leg.index] = total; total += leg.distanceNm; });
  return calculateVerticalProfileConflicts(profile).flatMap(conflict => legs.filter(leg => offsets[leg.index] < conflict.endNm && offsets[leg.index] + leg.distanceNm > conflict.startNm).map(leg => ({
    id: `${conflict.id}-${leg.index}`, severity: 'conflict' as const, category: 'profile' as const, blocksTransfer: true, legIndex: leg.index,
    startNm: Math.max(0, conflict.startNm - offsets[leg.index]), endNm: Math.min(leg.distanceNm, conflict.endNm - offsets[leg.index]), title: 'Climb/descent overlap',
    detail: formatVerticalConflict(conflict), action: verticalConflictAdvice(conflict), focus: 'profile' as const,
  })));
}
