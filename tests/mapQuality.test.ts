import { describe, expect, it } from 'vitest';
import {
  chartDetailRatioCap,
  vfrPixelRatio,
  vfrTilePixels,
} from '../src/map/icaoQuality';

function tileYForLatitude(latitudeDeg: number, zoom: number): number {
  const latitudeRad = (latitudeDeg * Math.PI) / 180;
  const n = 2 ** zoom;
  return Math.floor(
    ((1 - Math.asinh(Math.tan(latitudeRad)) / Math.PI) / 2) * n,
  );
}

describe('ICAO chart raster quality', () => {
  it('requests more source pixels at overview zooms over Tromsø', () => {
    const y9 = tileYForLatitude(69.65, 9);
    const y11 = tileYForLatitude(69.65, 11);

    expect(vfrTilePixels(9, y9, 1)).toBeGreaterThan(256);
    expect(vfrTilePixels(9, y9, 1)).toBeGreaterThan(vfrTilePixels(11, y11, 1));
  });

  it('keeps raster requests bounded and aligned to 8 pixels', () => {
    const y = tileYForLatitude(69.65, 7);
    const pixels = vfrTilePixels(7, y, 1, 'sharp');

    expect(pixels).toBeLessThanOrEqual(1024);
    expect(pixels % 8).toBe(0);
  });

  it('uses a lighter automatic overview mode but preserves sharp working zooms', () => {
    expect(chartDetailRatioCap(9, 'auto')).toBe(2);
    expect(chartDetailRatioCap(10, 'auto')).toBe(4);
    expect(chartDetailRatioCap(9, 'fast')).toBe(1);
    expect(chartDetailRatioCap(9, 'sharp')).toBe(4);
  });

  it('honours high-density displays without exceeding the 4x cap', () => {
    const y = tileYForLatitude(69.65, 11);

    expect(vfrPixelRatio(11, y, 2)).toBeGreaterThanOrEqual(2);
    expect(vfrPixelRatio(11, y, 8)).toBe(4);
  });
});
