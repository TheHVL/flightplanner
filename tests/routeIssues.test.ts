import { describe, expect, it } from 'vitest';
import { calculateRouteLegs } from '../src/navigation/geodesy';
import { airspaceRouteIssues, applyPublishedMax, rasterRouteIssues, terrainRouteIssues } from '../src/routing/issues';
import { polygonContains, segmentTouchesPolygon } from '../src/routing/geometry';
import type { TerrainReview } from '../src/routing/terrain';
import type { RadioCatalog } from '../src/frequencies/catalog';
import { reviewLegAirspace } from '../src/routing/airspace';
const legs = calculateRouteLegs([{ id: 'a', name: 'Berg', lat: 69, lon: 19 }, { id: 'b', name: 'Breivika', lat: 69.2, lon: 19 }]);
describe('actionable route checks', () => {
  it('keeps controlling altitude and terrain at the same sample and identifies a cap conflict', () => {
    const terrain: TerrainReview = { sourceUrl: 'https://ws.geonorge.no/', fetchedAt: '', failedBatches: 0,
      probes: [{ lat: 69.05, lon: 19, legIndex: 0, distanceNm: 3, offsetNm: 0.5, altitudeFt: 1000 }, { lat: 69.1, lon: 19, legIndex: 0, distanceNm: 6, offsetNm: 0, altitudeFt: 4000 }],
      heights: [{ elevationFt: 900, terrain: 'Rock', dataset: 'dtm1' }, { elevationFt: 3000, terrain: 'Rock', dataset: 'dtm1' }] };
    const issues = applyPublishedMax(terrainRouteIssues(terrain, legs), () => 1000);
    expect(issues).toHaveLength(1); expect(issues[0].legIndex).toBe(0);
    expect(issues[0].detail).toContain('modeled altitude 1000 ft, surface 900 ft, margin 100 ft');
    expect(issues[0].detail).toContain('3.0 NM'); expect(issues[0].detail).toContain('MAX 1000 ft');
    expect(issues[0].action).toContain('cannot override'); expect(issues[0].blocksTransfer).toBe(true);
    expect(issues[0].detail).not.toContain('surface 3000 ft');
  });
  it('distinguishes missing coverage, low terminal margins and a coarse raster/MAX conflict', () => {
    const terrain: TerrainReview = { sourceUrl: '', fetchedAt: '', failedBatches: 0,
      probes: [{ ...legs[0].from, legIndex: 0, distanceNm: 0, offsetNm: 0, altitudeFt: 100 }, { ...legs[0].to, legIndex: 0, distanceNm: 12, offsetNm: 0, altitudeFt: null }],
      heights: [{ elevationFt: 50, terrain: 'Rock', dataset: 'dtm1' }, null] };
    const issues = terrainRouteIssues(terrain, legs, [legs[0].from]);
    expect(issues.find(i => i.title === 'Terrain heights missing')?.severity).toBe('incomplete');
    expect(issues.find(i => i.title === 'Modeled altitude unavailable')?.blocksTransfer).toBe(true);
    expect(issues.find(i => i.title === 'Airport-area terrain needs review')?.blocksTransfer).toBe(false);
    const raster = rasterRouteIssues([{ legIndex: 0, startNm: 1, endNm: 1.5, highestFt: 950, altitudeFt: 1000, conflicts: 3, missing: 0 }], legs, () => 1000)[0];
    expect(raster.detail).toContain('at least 1500 ft'); expect(raster.title).toContain('published MAX'); expect(raster.action).toContain('another entry/exit');
  });
  it('does not mislabel controlled airspace as a prohibited route or a frequency as clearance', () => {
    const area = { id: 'test', name: 'Test CTR', type: 'CTR', sourceUrl: 'https://aim-prod.avinor.no/', volumes: [{ polygon: [[18,68],[20,68],[20,70],[18,70],[18,68]], lower: { reference: 'GND', value: 0 }, upper: { reference: 'AMSL', value: 5000 }, publishedLimits: 'GND–5000 FT AMSL' }] };
    const issues = airspaceRouteIssues(reviewLegAirspace(legs[0], { airspaces: [area] } as RadioCatalog, () => 1000));
    expect(issues[0].severity).toBe('review'); expect(issues[0].blocksTransfer).toBe(false); expect(issues[0].action).toContain('not a clearance');
    const restriction = { ...area, id: 'END999', name: 'Synthetic test danger area', type: 'D', activation: 'unknown' };
    const danger = airspaceRouteIssues(reviewLegAirspace(legs[0], { airspaces: [], restrictions: [restriction] } as unknown as RadioCatalog, () => 1000))[0];
    expect(danger.blocksTransfer).toBe(true); expect(danger.detail).toContain('not a claim');
  });
  it('retains boundary-running legs and narrow crossings even when both endpoints are outside', () => {
    const polygon = [[0,0],[2,0],[2,1],[0,1],[0,0]];
    expect(polygonContains([1,0], polygon)).toBe(true);
    expect(segmentTouchesPolygon([-1,0], [3,0], polygon)).toBe(true);
    expect(segmentTouchesPolygon([-1,0.5], [3,0.5], polygon)).toBe(true);
    expect(segmentTouchesPolygon([-1,-1], [3,-1], polygon)).toBe(false);
  });
});
