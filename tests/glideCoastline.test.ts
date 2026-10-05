import { describe, expect, it } from 'vitest';
import {
  analyzeGlideCoastline,
  prepareLandMask,
} from '../src/navigation/glideCoastline';
import type { GlideEnvelopeSample } from '../src/navigation/glideEnvelope';

const mask = prepareLandMask({
  type: 'FeatureCollection',
  clipBounds: [-2, -2, 2, 2],
  features: [{
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ]],
    },
  }],
});

function sample(
  routeDistanceNm: number,
  lat: number,
  lon: number,
  glideRangeNm: number,
): GlideEnvelopeSample {
  return {
    routeDistanceNm,
    lat,
    lon,
    modeledAltitudeFtMsl: glideRangeNm * 700,
    glideRangeNm,
  };
}

describe('automatic glide coastline analysis', () => {
  it('distinguishes land, reachable coastline, marginal coastline and no coastline in glide range', () => {
    const result = analyzeGlideCoastline([
      sample(0, 0.5, 0.5, 5),
      sample(1, 0.5, 1.05, 5),
      sample(2, 0.5, 1.07, 5),
      sample(3, 0.5, 1.2, 5),
    ], mask);

    expect(result.samples[0].status).toBe('land');
    expect(result.samples[1].status).toBe('water-reachable');
    expect(result.samples[1].coastlineDistanceNm).toBeCloseTo(3, 1);
    expect(result.samples[2].status).toBe('water-marginal');
    expect(result.samples[2].coastlineMarginNm).toBeGreaterThan(0);
    expect(result.samples[2].coastlineMarginNm).toBeLessThanOrEqual(1);
    expect(result.samples[3].status).toBe('water-unreachable');
    expect(result.unreachableSampleCount).toBe(1);
    expect(result.marginalSampleCount).toBe(1);
    expect(result.mapSegments.some((segment) => segment.severity === 'unreachable')).toBe(true);
    expect(result.mapSegments.some((segment) => segment.severity === 'marginal')).toBe(true);
  });

  it('treats holes in a land polygon as water', () => {
    const lakeMask = prepareLandMask({
      type: 'FeatureCollection',
      clipBounds: [-1, -1, 4, 4],
      features: [{
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [
            [[0, 0], [3, 0], [3, 3], [0, 3], [0, 0]],
            [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
          ],
        },
      }],
    });

    const result = analyzeGlideCoastline([
      sample(0, 0.5, 0.5, 5),
      sample(1, 1.5, 1.5, 40),
    ], lakeMask);

    expect(result.samples[0].status).toBe('land');
    expect(result.samples[1].status).not.toBe('land');
    expect(result.samples[1].coastlineDistanceNm).not.toBeNull();
  });

  it('does not claim coverage outside the bundled mask bounds', () => {
    const result = analyzeGlideCoastline([
      sample(0, 5, 5, 10),
    ], mask);

    expect(result.samples[0].status).toBe('outside-coverage');
    expect(result.outsideCoverageSampleCount).toBe(1);
    expect(result.warnings.some((warning) => warning.includes('outside'))).toBe(true);
  });
});
