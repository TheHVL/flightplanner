import { describe, expect, it } from 'vitest';
import { reviewLegAirspace } from '../src/routing/airspace';
import { calculateRouteLegs, greatCircleDistanceNm } from '../src/navigation/geodesy';
import type { RadioArea, RadioCatalog } from '../src/frequencies/catalog';
const area = (id: string, x: number, X: number, type = 'CTR'): RadioArea => ({ id, name: id, type, unit: id, callSign: id, channels: [{ channel: '118.105' }], hours: '', remarks: '', sourceUrl: 'https://aim-prod.avinor.no/aip',
  volumes: [{ polygon: [[x,-1],[X,-1],[X,1],[x,1],[x,-1]], lower: { reference: 'AMSL', value: 2000 }, upper: { reference: 'AMSL', value: 4000 }, publishedLimits: '2000–4000 FT AMSL' }] });
const catalog = (airspaces: RadioArea[]) => ({ airspaces } as RadioCatalog);
const leg = calculateRouteLegs([{ id: 'a', name: 'A', lat: 0, lon: 0 }, { id: 'b', name: 'B', lat: 0, lon: 0.2 }])[0];
describe('terminal airspace review', () => {
  it('retains a narrow boundary crossing and excludes Polaris radio sectors', () => {
    const results = reviewLegAirspace(leg, catalog([area('narrow', 0.1001, 0.1003), area('Polaris', -1, 1, 'sector')]), () => 3000);
    expect(results).toHaveLength(1);
    expect(results[0].relation).toBe('intersects');
    expect(results[0].endNm - results[0].startNm).toBeLessThan(0.02);
  });
  it('splits climb and descent at published altitude boundaries', () => {
    const data = catalog([area('TMA', -1, 1, 'TMA')]);
    const results = reviewLegAirspace(leg, data, distance => 1000 + 4000 * distance / leg.distanceNm);
    expect(results.map(r => r.relation)).toEqual(['below','intersects','above']);
    expect(results[0].endNm).toBeCloseTo(leg.distanceNm / 4, 4);
    expect(results[1].endNm).toBeCloseTo(leg.distanceNm * 3 / 4, 4);
    expect(reviewLegAirspace(leg, data, () => null)[0].relation).toBe('review');
  });
  it('follows a shaped route instead of reporting a direct-route intersection', () => {
    const bend = { lat: 2, lon: 0.1 };
    const shaped = { ...leg, path: [leg.from, bend, leg.to], distanceNm: greatCircleDistanceNm(leg.from, bend) + greatCircleDistanceNm(bend, leg.to) };
    expect(reviewLegAirspace(shaped, catalog([area('middle', 0.09, 0.11)]), () => 3000)).toEqual([]);
  });
  it('requires review for flight-level, AGL and unresolved volume references', () => {
    const fl = area('FL', -1, 1); fl.volumes[0].upper = { reference: 'FL', value: 4000 };
    const agl = area('AGL', -1, 1); agl.volumes[0].lower = { reference: 'AGL', value: 2000 };
    const unknown = area('unresolved', -1, 1); unknown.unresolvedGeometry = true;
    expect(reviewLegAirspace(leg, catalog([fl, agl, unknown]), () => 3000).map(r => r.relation)).toEqual(['review','review','review']);
  });
});
