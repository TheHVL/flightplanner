import { FlightPlanStore } from '../flightplan/FlightPlanStore';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../fuel/fuelPlanning';
import { modeledAltitudeFtAtRouteDistance } from '../navigation/glideEnvelope';
import { greatCircleDistanceNm } from '../navigation/geodesy';
import { reviewLegAirspace, type AirspaceEncounter } from '../routing/airspace';
import { buildTerrainProbes, fetchTerrainReview, type TerrainReview } from '../routing/terrain';
import type { RadioCatalog } from '../frequencies/catalog';
import type { GeneratorRequest, RouteCandidate } from './candidates';

export interface CandidateReview {
  candidate: RouteCandidate; terrain: TerrainReview;
  transitConflicts: number; airportLowSamples: number; missingHeights: number;
  unknownAltitudes: number; minimumTransitMarginFt: number | null;
  airspace: AirspaceEncounter[]; airspaceAvailable: boolean;
}
/** Checks rank draft alternatives. Missing data never produces a clear/safe result. */
export async function reviewCandidates(candidates: RouteCandidate[], request: GeneratorRequest, airspace: RadioCatalog | null,
  signal: AbortSignal, progress?: (done: number, total: number) => void): Promise<CandidateReview[]> {
  const allProbes = candidates.flatMap((candidate, index) => {
    const model = candidateModel(candidate, request);
    return buildTerrainProbes(candidate.legs, (leg, distance) => model.at(leg.index, distance)).map(p => ({ ...p, legIndex: p.legIndex + index * 1000 }));
  });
  // Sequential chunks keep the service's 6000-probe budget and three-worker limit.
  // Never silently trim the coverage of a longer set of alternatives.
  let terrain: TerrainReview = { probes: allProbes, heights: [], fetchedAt: new Date().toISOString(), sourceUrl: 'https://ws.geonorge.no/hoydedata/v1/', failedBatches: 0 };
  for (let start = 0; start < allProbes.length; start += 6000) {
    const batch = await fetchTerrainReview(allProbes.slice(start, start + 6000), signal, done => progress?.(start + done, allProbes.length));
    terrain = { ...terrain, heights: [...terrain.heights, ...batch.heights], fetchedAt: batch.fetchedAt, failedBatches: terrain.failedBatches + batch.failedBatches };
  }
  return candidates.map((candidate, index) => {
    const entries = terrain.probes.flatMap((probe, i) => probe.legIndex >= index * 1000 && probe.legIndex < (index + 1) * 1000 ? [{ probe: { ...probe, legIndex: probe.legIndex - index * 1000 }, height: terrain.heights[i] }] : []);
    const review: TerrainReview = { ...terrain, probes: entries.map(p => p.probe), heights: entries.map(p => p.height) };
    const airports = candidate.draft.waypoints.filter(point => /^[A-Z]{4}$/.test(point.aipId ?? ''));
    let transitConflicts = 0, airportLowSamples = 0, missingHeights = 0, unknownAltitudes = 0, minimumTransitMarginFt: number | null = null;
    entries.forEach(({ probe, height }) => {
      if (!height) { missingHeights++; return; }
      if (probe.altitudeFt === null || !Number.isFinite(probe.altitudeFt)) { unknownAltitudes++; return; }
      const margin = probe.altitudeFt - height.elevationFt;
      // Departure/arrival low margins remain visible. They are not treated as
      // transit terrain avoidance because airport joins need their own review.
      const nearAirport = airports.some(a => greatCircleDistanceNm(a, probe) <= 3);
      if (nearAirport) { if (margin < 500) airportLowSamples++; }
      else { minimumTransitMarginFt = Math.min(minimumTransitMarginFt ?? Infinity, margin); if (margin < 500) transitConflicts++; }
    });
    const model = candidateModel(candidate, request); let offset = 0;
    const encounters = candidate.legs.flatMap(leg => {
      const result = airspace ? reviewLegAirspace(leg, airspace, distance => model.at(leg.index, distance), model.breaks.map(value => value - offset)) : [];
      offset += leg.distanceNm; return result;
    });
    return { candidate, terrain: review, transitConflicts, airportLowSamples, missingHeights, unknownAltitudes, minimumTransitMarginFt,
      airspace: encounters, airspaceAvailable: !!airspace };
  }).sort((a, b) => a.candidate.profileIssues.length - b.candidate.profileIssues.length || a.transitConflicts - b.transitConflicts ||
    (a.missingHeights + a.unknownAltitudes) - (b.missingHeights + b.unknownAltitudes) || Math.abs(a.candidate.durationDifference) - Math.abs(b.candidate.durationDifference));
}
function candidateModel(candidate: RouteCandidate, request: GeneratorRequest) {
  const store = new FlightPlanStore(); store.restoreWorkingDraftState(candidate.draft);
  const fuel = calculateFuelPlanForStore(store, { ...DEFAULT_FUEL_PLANNING_SETTINGS, descentFuelFlowGph: request.descentFuelFlowGph, circuitFuelFlowGph: request.patternFuelFlowGph });
  const levels = candidate.legs.map(leg => store.getPlannedAltitudeFt(leg.from.id, leg.to.id));
  const offsets: number[] = []; let offset = 0;
  candidate.legs.forEach(leg => { offsets[leg.index] = offset; offset += leg.distanceNm; });
  const profile = fuel.verticalProfile;
  return { at: (index: number, distance: number) => !profile || candidate.profileIssues.length ? null : modeledAltitudeFtAtRouteDistance(candidate.legs, levels, profile.events, offsets[index] + distance),
    breaks: profile?.events.flatMap(event => event.type === 'TOC' ? [event.routeDistanceNm - event.distanceNm, event.routeDistanceNm] : [event.routeDistanceNm, event.routeDistanceNm + event.distanceNm]) ?? [] };
}
