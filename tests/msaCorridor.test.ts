import { describe, expect, it } from 'vitest';
// Reference coordinates generated with Python GeographicLib 2.1, Geodesic.WGS84.Direct.
import offsets from './fixtures/wgs84Offsets.json';
import { densifyRoutePath, greatCircleDistanceNm } from '../src/navigation/geodesy';
import {
  buildLegCorridorPolygon,
  destinationCoordinate,
  MSA_CORRIDOR_HALF_WIDTH_NM,
} from '../src/navigation/msaCorridor';

describe('MSA corridor geometry', () => {
  it('matches independent GeographicLib WGS84 offsets across Norwegian latitudes and bearings', () => {
    for (const sample of offsets) {
      const point = destinationCoordinate(sample.start, sample.bearing, sample.distanceNm);
      expect(point.lat).toBeCloseTo(sample.expected.lat, 8);
      expect(point.lon).toBeCloseTo(sample.expected.lon, 8);
    }
    expect(destinationCoordinate({ lat: 69, lon: 18 }, 0, 0)).toEqual({ lat: 69, lon: 18 });
    expect(() => destinationCoordinate({ lat: 91, lon: 18 }, 0, 1)).toThrow();
    expect(() => destinationCoordinate({ lat: 69, lon: 18 }, 0, -1)).toThrow();
  });

  it('builds a corridor approximately 1 NM either side of both leg endpoints', () => {
    const from = { lat: 69.6492, lon: 18.9553 };
    const to = { lat: 69.2, lon: 19.7 };
    const polygon = buildLegCorridorPolygon(from, to);

    const count = densifyRoutePath([from, to]).length;
    expect(polygon).toHaveLength(count * 2);
    expect(greatCircleDistanceNm(from, polygon[0])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 2);
    expect(greatCircleDistanceNm(from, polygon[polygon.length - 1])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 2);
    expect(greatCircleDistanceNm(to, polygon[count - 1])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 2);
    expect(greatCircleDistanceNm(to, polygon[count])).toBeCloseTo(MSA_CORRIDOR_HALF_WIDTH_NM, 2);
  });

  it('rejects a non-positive corridor width', () => {
    expect(() => buildLegCorridorPolygon({ lat: 69, lon: 18 }, { lat: 70, lon: 19 }, 0)).toThrow();
  });
});
