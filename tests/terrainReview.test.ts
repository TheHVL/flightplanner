import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildTerrainProbes, fetchTerrainReview, parseTerrainHeights, summarizeTerrainLeg } from '../src/routing/terrain';
import { calculateRouteLegs, coordinateAtRouteDistance, greatCircleDistanceNm } from '../src/navigation/geodesy';
import type { TerrainProbe } from '../src/routing/terrain';
afterEach(() => vi.unstubAllGlobals());
const legs = calculateRouteLegs([{ id: 'a', name: 'A', lat: 69, lon: 18 }, { id: 'b', name: 'B', lat: 69.02, lon: 18.1 }]);
describe('sampled terrain review', () => {
  it('samples the plotted bend and both corridor edges at the modeled climb altitude', () => {
    const bend = { lat: 69.04, lon: 18.05 };
    const leg = { ...legs[0], path: [legs[0].from, bend, legs[0].to], distanceNm: greatCircleDistanceNm(legs[0].from, bend) + greatCircleDistanceNm(bend, legs[0].to) };
    const probes = buildTerrainProbes([leg], (_leg, distance) => 254 + distance * 300);
    const bendProbe = probes.find(p => p.offsetNm === 0 && greatCircleDistanceNm(p, bend) < 0.00001)!;
    expect(bendProbe).toBeDefined();
    expect(bendProbe.altitudeFt).toBeCloseTo(254 + greatCircleDistanceNm(leg.from, bend) * 300);
    for (const p of probes) {
      const sphericalDistance = greatCircleDistanceNm(p, coordinateAtRouteDistance([leg], p.distanceNm)!);
      // Ellipsoidal distances are tested independently against GeographicLib fixtures.
      expect(sphericalDistance).toBeLessThanOrEqual(Math.abs(p.offsetNm));
      expect(sphericalDistance).toBeGreaterThanOrEqual(Math.abs(p.offsetNm) * 0.995);
    }
    const distances = probes.filter(p => p.offsetNm === 0).map(p => p.distanceNm);
    expect(Math.max(...distances.slice(1).map((value, i) => value - distances[i]))).toBeLessThanOrEqual(0.500001);
  });
  it('matches reordered coordinates, uses sea surface instead of seabed and leaves missing heights unknown', () => {
    const heights = parseTerrainHeights({ koordsys: 4258, punkter: [
      { x: 19, y: 69, z: -800, datakilde: 'seabed', terreng: 'Havflate' },
      { x: 18, y: 69, z: 304.8, datakilde: 'dtm1', terreng: 'Skog' },
      { x: 20, y: 69, z: null, datakilde: 'dtm1', terreng: 'Skog' },
      { x: 22, y: 69, z: 304.8, datakilde: 'dtm1', terreng: null },
      { x: 23, y: 69, z: -800, datakilde: 'dybdekurver', terreng: null },
    ] }, [18,19,20,21,22,23].map(lon => ({ lon, lat: 69 })));
    expect(heights.map(h => h?.elevationFt ?? null)).toEqual([1000, 0, null, null, 1000, null]);
    expect(() => parseTerrainHeights({ koordsys: 4326, punkter: [] }, [])).toThrow();
  });
  it('retains explicit sea-surface provenance when Kartverket has no seabed height', () => {
    const point = { lat: 69.61477714180477, lon: 18.82201553937682 };
    const response = { koordsys: 4258, punkter: [
      { datakilde: null, terreng: 'Havflate', x: 18.82201554, y: 69.61477714, z: null },
    ] };
    expect(parseTerrainHeights(response, [point])).toEqual([
      { elevationFt: 0, terrain: 'Havflate', dataset: 'N50 surface classification', surfaceOnly: true },
    ]);
    expect(parseTerrainHeights({ ...response, punkter: [...response.punkter, ...response.punkter] }, [point])).toEqual([null]);
    expect(parseTerrainHeights(response, [{ ...point, lon: point.lon + 0.01 }])).toEqual([null]);
  });
  it('keeps unknown land, lakes, unclassified depths and malformed sea responses missing', () => {
    const entries = [
      { terreng: 'Skog', z: null, datakilde: 'dtm1' },
      { terreng: 'Innsjø', z: null, datakilde: null },
      { terreng: null, z: null, datakilde: null },
      { terreng: null, z: -800, datakilde: 'dybdekurver' },
      { terreng: 'Havflate', z: '0', datakilde: null },
      { terreng: 'Havflate', z: 9001, datakilde: 'dtm1' },
      { terreng: 'Havflate', z: -12001, datakilde: 'seabed' },
    ];
    const points = entries.map((_, i) => ({ lat: 69, lon: 18 + i }));
    expect(parseTerrainHeights({ koordsys: 4258, punkter: entries.map((entry, i) => ({ ...entry, x: points[i].lon, y: points[i].lat })) }, points)).toEqual(entries.map(() => null));
  });
  it('batches at most 50 points, exposes network gaps and reports low altitude margins', async () => {
    const probes: TerrainProbe[] = Array.from({ length: 105 }, (_, i) => ({ legIndex: 0, distanceNm: i / 2, offsetNm: 0, altitudeFt: i === 0 ? null : 400, lat: 69, lon: 18 + i / 1000 }));
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.searchParams.get('koordsys')).toBe('4258');
      const points: number[][] = JSON.parse(url.searchParams.get('punkter')!);
      expect(points.length).toBeLessThanOrEqual(50);
      if (points[0][0] === 18.05) throw new Error('offline batch');
      return new Response(JSON.stringify({ koordsys: 4258, punkter: points.map(([x, y]) => ({ x, y, z: 0, datakilde: 'dtm1', terreng: 'Skog' })) }));
    });
    vi.stubGlobal('fetch', fetcher);
    const review = await fetchTerrainReview(probes, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(review.failedBatches).toBe(1);
    expect(summarizeTerrainLeg(review, 0)).toMatchObject({ missing: 50, count: 105, highestFt: 0, minimumMarginFt: 400, lowMarginCount: 54, unknownAltitudeCount: 1 });
  });
  it('withholds aborted checks and rejects oversized routes without silently reducing coverage', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(fetchTerrainReview(buildTerrainProbes(legs, () => 3000), controller.signal)).rejects.toThrow();
    expect(() => buildTerrainProbes([{ ...legs[0], distanceNm: 1000 }], () => 3000)).toThrow('6000');
  });
  it('deduplicates shared waypoint coordinates without losing either leg sample', async () => {
    const probe: TerrainProbe = { lat: 69, lon: 18, legIndex: 0, distanceNm: 1, offsetNm: 0, altitudeFt: 3000 };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const points = JSON.parse(new URL(String(input)).searchParams.get('punkter')!);
      expect(points).toEqual([[18,69]]);
      return new Response(JSON.stringify({ koordsys: 4258, punkter: [{ x: 18, y: 69, z: 0, datakilde: 'dtm1', terreng: 'Skog' }] }));
    }));
    const result = await fetchTerrainReview([probe, { ...probe, legIndex: 1, distanceNm: 0 }], new AbortController().signal);
    expect(result.heights.map(h => h?.elevationFt)).toEqual([0,0]);
  });
});
