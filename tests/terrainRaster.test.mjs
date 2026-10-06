import { afterEach, expect, it, vi } from 'vitest';
import { writeArrayBuffer } from 'geotiff';
import { decodeTerrainRaster, fetchRouteTerrainRaster } from '../src/routing/terrainRaster';

function tiff(values, width, height, west = 600000, north = 7740000, resolution = 200, projection = 25833) {
  return writeArrayBuffer(values, { width, height, BitsPerSample: [32], SampleFormat: [3],
    ModelPixelScale: [resolution, resolution, 0], ModelTiepoint: [0, 0, 0, west, north, 0],
    GTModelTypeGeoKey: 1, GTRasterTypeGeoKey: 1, ProjectedCSTypeGeoKey: projection });
}
afterEach(() => vi.unstubAllGlobals());
it('reads numeric GeoTIFF heights, clamps sea-surface noise and retains missing pixels', async () => {
  const data = await decodeTerrainRaster(tiff(new Float32Array([0, 850, -0.01, NaN]), 2, 2));
  expect(data.resolutionM).toBe(200); expect(data.elevationsM[1]).toBe(850);
  expect(data.elevationsM[2]).toBe(0); expect(Number.isNaN(data.elevationsM[3])).toBe(true);
  await expect(decodeTerrainRaster(tiff(new Float32Array(4), 2, 2, 600000, 7740000, 200, 25832))).rejects.toThrow('projection');
});
it('assembles matching fresh WCS windows and rejects wrong tile geometry', async () => {
  const requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url, options) => {
    const u = new URL(String(url)), [west, , , north] = u.searchParams.get('bbox').split(',').map(Number);
    const width = Number(u.searchParams.get('width')), height = Number(u.searchParams.get('height'));
    requests.push({ u, options });
    return new Response(tiff(new Float32Array(width * height).fill(123), width, height, west, north));
  }));
  const result = await fetchRouteTerrainRaster([{ lat: 69.2, lon: 19 }, { lat: 69.3, lon: 19.1 }], new AbortController().signal);
  expect(result.elevationsM.every(v => v === 123)).toBe(true);
  expect(requests.every(r => r.options.cache === 'no-store' && r.u.searchParams.get('coverage') === 'nhm_dtm_topo_25833')).toBe(true);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(tiff(new Float32Array(4), 2, 2))));
  await expect(fetchRouteTerrainRaster([{ lat: 69.2, lon: 19 }, { lat: 69.3, lon: 19.1 }], new AbortController().signal)).rejects.toThrow('does not match');
});
it('fails visibly on service errors and never requests data after cancellation', async () => {
  const fetch = vi.fn(async () => new Response('Unavailable', { status: 503 })); vi.stubGlobal('fetch', fetch);
  const points = [{ lat: 69.2, lon: 19 }, { lat: 69.3, lon: 19.1 }];
  await expect(fetchRouteTerrainRaster(points, new AbortController().signal)).rejects.toThrow('No straight-line fallback');
  const aborted = new AbortController(); aborted.abort(); fetch.mockClear();
  await expect(fetchRouteTerrainRaster(points, aborted.signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});
