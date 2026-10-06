import { candidateAltitudeModel } from './model';
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
    const model = candidateAltitudeModel(candidate, request);
    return buildTerrainProbes(candidate.legs, (leg, distance) => model.at(leg.index, distance)).map(p => ({ ...p, legIndex: p.legIndex + index * 1000 }));
  });
  // Shared route sections need one height lookup, even when candidate altitudes
  // differ. Map the returned heights back to every original modeled probe.
  const key = (p: { lat: number; lon: number }) => `${p.lon.toFixed(8)},${p.lat.toFixed(8)}`;
  const unique = [...new Map(allProbes.map(p => [key(p), p])).values()];
  let terrain: TerrainReview = { probes: allProbes, heights: [], fetchedAt: new Date().toISOString(), sourceUrl: 'https://ws.geonorge.no/hoydedata/v1/', failedBatches: 0 };
  const byPoint = new Map<string, TerrainReview['heights'][number]>();
  for (let start = 0; start < unique.length; start += 6000) {
    const probes = unique.slice(start, start + 6000);
    const batch = await fetchTerrainReview(probes, signal, done => progress?.(start + done, unique.length));
    probes.forEach((p, i) => byPoint.set(key(p), batch.heights[i] ?? null));
    terrain = { ...terrain, fetchedAt: batch.fetchedAt, failedBatches: terrain.failedBatches + batch.failedBatches };
  }
  terrain.heights = allProbes.map(p => byPoint.get(key(p)) ?? null);
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
    const model = candidateAltitudeModel(candidate, request); let offset = 0;
    const encounters = candidate.legs.flatMap(leg => {
      const result = airspace ? reviewLegAirspace(leg, airspace, distance => model.at(leg.index, distance), model.breaks.map(value => value - offset)) : [];
      offset += leg.distanceNm; return result;
    });
    return { candidate, terrain: review, transitConflicts, airportLowSamples, missingHeights, unknownAltitudes, minimumTransitMarginFt,
      airspace: encounters, airspaceAvailable: !!airspace };
  }).sort((a, b) => a.candidate.profileIssues.length - b.candidate.profileIssues.length || (a.candidate.searchTerrain.conflicts + a.transitConflicts) - (b.candidate.searchTerrain.conflicts + b.transitConflicts) ||
    (a.candidate.searchTerrain.missingCorridors + a.missingHeights + a.unknownAltitudes) - (b.candidate.searchTerrain.missingCorridors + b.missingHeights + b.unknownAltitudes) || Math.abs(a.candidate.durationDifference) - Math.abs(b.candidate.durationDifference));
}
