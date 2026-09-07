import { describe, expect, it } from 'vitest';
import { greatCircleDistanceNm } from '../src/navigation/geodesy';
import {
  buildLegCorridorPolygon,
  destinationCoordinate,
  MSA_CORRIDOR_HALF_WIDTH_NM,
} from '../src/navigation/msaCorridor';

describe('MSA corridor geometry', () => {
  it('places a destination point at the requested nautical-mile distance', () => {
    const start = { lat: 69.6492, lon: 18.9553 };
    const point = destinationCoordinate(start, 90, 1);

    expect(greatCircleDistanceNm(start, point)).toBeCloseTo(1, 5);
  });

  it('builds a corridor approximately 1 NM either side of both leg endpoints', () => {
    const from = { lat: 69.6492, lon: 18.9553 };
    const to = { lat: 69.2, lon: 19.7 };
    const polygon = buildLegCorridorPolygon(from, to);

    expect(polygon).toHaveLength(4);
    expect(greatCircleDistanceNm(from, polygon[0])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 5);
    expect(greatCircleDistanceNm(from, polygon[3])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 5);
    expect(greatCircleDistanceNm(to, polygon[1])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 5);
    expect(greatCircleDistanceNm(to, polygon[2])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 5);
  });

  it('rejects a non-positive corridor width', () => {
    expect(() => buildLegCorridorPolygon({ lat: 69, lon: 18 }, { lat: 70, lon: 19 }, 0)).toThrow();
  });
});
