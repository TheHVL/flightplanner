import { expect, it, vi } from 'vitest';
import { generateRouteCandidates } from '../src/generator/candidates';
import { candidateReviewBlocksTransfer, reviewCandidates } from '../src/generator/review';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import { fetchTerrainReview } from '../src/routing/terrain';
import { generatorFixture, generatorNow, generatorRequest, generatorRaster, generatorRadioFixture } from './helpers/generatorFixture.mjs';
const mode = vi.hoisted(() => ({ value: 'conflict' }));
vi.mock('../src/routing/terrain', async importOriginal => {
  const original = await importOriginal();
  return { ...original, fetchTerrainReview: vi.fn(async (probes, signal) => {
    signal.throwIfAborted();
    return { probes, heights: probes.map(p => mode.value === 'missing' ? null : ({
      elevationFt: p.legIndex < 1000 && mode.value === 'conflict' ? 20000 : 0,
      dataset: 'dtm1', terrain: 'Skog',
    })), fetchedAt: generatorNow.toISOString(), sourceUrl: original.TERRAIN_SOURCE_URL, failedBatches: 0 };
  }) };
});
async function candidates() {
  const { catalog, refresh } = generatorFixture();
  return generateRouteCandidates(generatorRequest, catalog, refresh, generatorNow, { raster: generatorRaster() });
}
it('ranks returned terrain conflicts ahead of duration preference and retains airport-area cautions', async () => {
  mode.value = 'conflict'; const drafts = await candidates();
  // Put the first synthetic alternative in a distinct test region. Coordinate
  // deduplication must share real heights, not candidate-dependent mountains.
  drafts[0].draft.waypoints.forEach(point => { point.lat += 2; });
  drafts[0].legs = calculateRouteLegs(drafts[0].draft.waypoints);
  fetchTerrainReview.mockClear();
  const result = await reviewCandidates(drafts, generatorRequest, null, new AbortController().signal);
  expect(result[0].candidate.id).not.toBe(drafts[0].id);
  // Shared coordinates inherit the same physical height in every alternative.
  expect(result[0].transitConflicts + result[0].candidate.searchTerrain.conflicts).toBeLessThan(result.find(r => r.candidate.id === drafts[0].id).transitConflicts + drafts[0].searchTerrain.conflicts);
  const blocked = result.find(r => r.candidate.id === drafts[0].id);
  expect(blocked.transitConflicts).toBeGreaterThan(0);
  expect(blocked.airportLowSamples).toBeGreaterThan(0);
  expect(result.every(r => r.airspaceAvailable === false)).toBe(true);
  const requested = fetchTerrainReview.mock.calls.flatMap(([points]) => points).map(p => `${p.lon.toFixed(8)},${p.lat.toFixed(8)}`);
  expect(new Set(requested).size).toBe(requested.length);
  expect(requested.length).toBeLessThan(result.reduce((sum, r) => sum + r.terrain.probes.length, 0));
});
it('retains missing coverage and withholds modeled altitudes for conflicting profiles', async () => {
  mode.value = 'missing'; const drafts = await candidates();
  let result = await reviewCandidates(drafts, generatorRequest, null, new AbortController().signal);
  expect(result.every(r => r.missingHeights === r.terrain.probes.length && r.minimumTransitMarginFt === null)).toBe(true);
  mode.value = 'normal'; drafts[0].profileIssues = ['Climb/descent profile needs correction.'];
  result = await reviewCandidates(drafts, generatorRequest, null, new AbortController().signal);
  const unknown = result.find(r => r.candidate.id === drafts[0].id);
  expect(unknown.unknownAltitudes).toBe(unknown.terrain.probes.length);
  expect(unknown.minimumTransitMarginFt).toBeNull();
  const aborted = new AbortController(); aborted.abort();
  await expect(reviewCandidates(drafts, generatorRequest, null, aborted.signal)).rejects.toThrow();
});
it('blocks missing restriction coverage and a terminal restriction encounter without claiming activation', async () => {
  mode.value = 'normal'; const drafts = await candidates();
  const oldRadio = generatorRadioFixture(); delete oldRadio.restrictions; delete oldRadio.restrictionCoverage;
  const missing = await reviewCandidates(drafts, generatorRequest, oldRadio, new AbortController().signal);
  expect(missing.every(candidateReviewBlocksTransfer)).toBe(true);
  expect(missing[0].issues.some(i => i.title === 'Published restriction coverage unavailable')).toBe(true);
  const radio = generatorRadioFixture(), point = drafts[0].draft.waypoints[0];
  radio.restrictions[0].volumes[0].polygon = [[point.lon - 0.01, point.lat - 0.01], [point.lon + 0.01, point.lat - 0.01], [point.lon + 0.01, point.lat + 0.01], [point.lon - 0.01, point.lat + 0.01], [point.lon - 0.01, point.lat - 0.01]];
  const result = await reviewCandidates(drafts, generatorRequest, radio, new AbortController().signal);
  expect(result.every(candidateReviewBlocksTransfer)).toBe(true);
  const issue = result[0].issues.find(i => i.category === 'airspace' && i.blocksTransfer);
  expect(issue.legIndex).toBe(0); expect(issue.detail).toContain('Activation is unknown');
});
