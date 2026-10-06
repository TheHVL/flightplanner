import { describe, expect, it } from 'vitest';
import { TerrainRouter } from '../src/routing/terrainRouter';
import { projectTerrainPoint, rasterCorridorMaximumM, unprojectTerrainPoint, type TerrainRaster } from '../src/routing/terrainRaster';
import { northernAirports } from '../src/routing/northernAirports';
import type { AipAerodromeCatalog } from '../src/aip/aerodromes';
import type { RadioCatalog } from '../src/frequencies/catalog';
import { restrictionSegmentAllowed } from '../src/routing/restrictions';

function raster(): TerrainRaster {
  return { west: 600000, north: 7740000, resolutionM: 200, width: 250, height: 250,
    elevationsM: new Float32Array(250 * 250), fetchedAt: '2026-10-06T12:00:00Z', sourceUrl: 'https://wcs.geonorge.no/' };
}
function paint(r: TerrainRaster, x0: number, x1: number, y0: number, y1: number, value: number): void {
  for (let row = y0; row < y1; row++) for (let col = x0; col < x1; col++) r.elevationsM[row * r.width + col] = value;
}
const point = (x: number, y: number) => unprojectTerrainPoint({ x: 600000 + x, y: 7740000 - y });
const signal = () => new AbortController().signal;

describe('generic terrain route search', () => {
  it('detours around a published restriction on flat terrain and preserves avoidance during simplification', async () => {
    const r = raster();
    const polygon = [[21000,17000],[29000,17000],[29000,33000],[21000,33000],[21000,17000]].map(([x,y]) => { const p = point(x,y); return [p.lon,p.lat]; });
    const data = { restrictions: [{ volumes: [{ polygon }] }] } as unknown as RadioCatalog;
    const allowed = restrictionSegmentAllowed(data, r), from = point(10000,25000), to = point(40000,25000);
    expect(allowed(projectTerrainPoint(from), projectTerrainPoint(to))).toBe(false);
    const route = await new TerrainRouter(r).findPath(from, to, 5000, signal(), {}, allowed);
    expect(route).not.toBeNull(); expect(route!.points.length).toBeGreaterThan(2);
    for (let i = 1; i < route!.points.length; i++) expect(allowed(projectTerrainPoint(route!.points[i - 1]), projectTerrainPoint(route!.points[i]))).toBe(true);
    // No unchecked direct fallback when an endpoint is inside an avoided footprint.
    expect(await new TerrainRouter(r).findPath(point(25000,25000), to, 9000, signal(), {}, allowed)).toBeNull();
  });
  it('detours around a ridge and cannot simplify the turns back across it', async () => {
    const r = raster(); paint(r, 105, 145, 70, 180, 1600);
    const from = point(10000, 25000), to = point(40000, 25000);
    const result = await new TerrainRouter(r).findPath(from, to, 3000, signal());
    expect(result).not.toBeNull(); expect(result!.points.length).toBeGreaterThan(2);
    expect(result!.points[0].lat).toBeCloseTo(from.lat, 7); expect(result!.points.at(-1)!.lon).toBeCloseTo(to.lon, 7);
    for (let i = 1; i < result!.points.length; i++) {
      expect(rasterCorridorMaximumM(r, projectTerrainPoint(result!.points[i - 1]), projectTerrainPoint(result!.points[i]))).toBeLessThanOrEqual((3000 - 500) * 0.3048);
    }
  });
  it('uses terrain beside the centreline and retains unknown coverage', () => {
    const r = raster(), from = projectTerrainPoint(point(10000, 25000)), to = projectTerrainPoint(point(40000, 25000));
    paint(r, 125, 126, 132, 133, 1200);
    expect(rasterCorridorMaximumM(r, from, to)).toBe(1200);
    paint(r, 150, 151, 125, 126, NaN);
    expect(rasterCorridorMaximumM(r, from, to)).toBeNull();
    expect(rasterCorridorMaximumM(r, projectTerrainPoint(point(100, 25000)), to)).toBeNull();
  });
  it('does not fall back to a straight line through an impassable ridge or missing-data barrier', async () => {
    for (const value of [1600, NaN]) {
      const r = raster(); paint(r, 105, 145, 0, 250, value);
      expect(await new TerrainRouter(r).findPath(point(10000, 25000), point(40000, 25000), 3000, signal())).toBeNull();
    }
  });
  it('allows a direct route when its returned raster corridor fits and honours cancellation', async () => {
    const router = new TerrainRouter(raster());
    expect((await router.findPath(point(10000, 25000), point(40000, 25000), 3000, signal()))!.points).toHaveLength(2);
    const aborted = new AbortController(); aborted.abort();
    await expect(router.findPath(point(10000, 25000), point(40000, 25000), 3000, aborted.signal)).rejects.toThrow();
  });
  it('keeps a detour when a higher cruise altitude still has a low departure gate', async () => {
    const r = raster(); paint(r, 90, 110, 70, 180, 900);
    const router = new TerrainRouter(r), from = point(10000, 25000), to = point(40000, 25000);
    expect((await router.findPath(from, to, 5000, signal()))!.points).toHaveLength(2);
    const limited = await router.findPath(from, to, 5000, signal(), { departureFt: 1000 });
    expect(limited).not.toBeNull(); expect(limited!.points.length).toBeGreaterThan(2);
  });
  it('derives mainland airport coverage from catalog coordinates and sorts by ICAO', () => {
    const catalog = { aerodromes: [
      { icao: 'ENTC', lat: 69.68, lon: 18.9 }, { icao: 'ENBO', lat: 67.269, lon: 14.4 },
      { icao: 'ENAT', lat: 69.98, lon: 23.3 }, { icao: 'ENAS', lat: 78.9, lon: 11.9 },
      { icao: 'ENRA', lat: 66.3, lon: 14.3 }, { icao: 'ENXX', lat: null, lon: null },
    ] } as AipAerodromeCatalog;
    expect(northernAirports(catalog).map(a => a.icao)).toEqual(['ENAT', 'ENBO', 'ENTC']);
  });
});
