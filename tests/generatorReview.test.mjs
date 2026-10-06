import { expect, it, vi } from 'vitest';
import { generateRouteCandidates } from '../src/generator/candidates';
import { reviewCandidates } from '../src/generator/review';
import { generatorFixture, generatorNow, generatorRequest } from './helpers/generatorFixture.mjs';
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
function candidates() {
  const { catalog, refresh } = generatorFixture();
  return generateRouteCandidates(generatorRequest, catalog, refresh, generatorNow);
}
it('ranks returned terrain conflicts ahead of duration preference and retains airport-area cautions', async () => {
  mode.value = 'conflict'; const drafts = candidates();
  const result = await reviewCandidates(drafts, generatorRequest, null, new AbortController().signal);
  expect(result[0].candidate.id).not.toBe(drafts[0].id);
  expect(result[0].transitConflicts).toBe(0);
  const blocked = result.find(r => r.candidate.id === drafts[0].id);
  expect(blocked.transitConflicts).toBeGreaterThan(0);
  expect(blocked.airportLowSamples).toBeGreaterThan(0);
  expect(result.every(r => r.airspaceAvailable === false)).toBe(true);
});
it('retains missing coverage and withholds modeled altitudes for conflicting profiles', async () => {
  mode.value = 'missing'; const drafts = candidates();
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
