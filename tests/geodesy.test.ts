import { describe, expect, it } from 'vitest';
import { greatCircleDistanceNm, initialTrueTrackDeg } from '../src/navigation/geodesy';
import { normalizeDegrees } from '../src/utils/angles';

describe('great-circle navigation', () => {
  it('calculates a known one-degree equatorial distance', () => {
    const distance = greatCircleDistanceNm({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    expect(distance).toBeCloseTo(60.04, 1);
  });

  it('calculates northbound initial track as 000 degrees', () => {
    const track = initialTrueTrackDeg({ lat: 68, lon: 18 }, { lat: 69, lon: 18 });
    expect(track).toBeCloseTo(0, 8);
  });

  it('handles a course crossing geographic north without wrapping errors', () => {
    const track = initialTrueTrackDeg({ lat: 85, lon: -45 }, { lat: 85, lon: 45 });
    expect(track).toBeGreaterThanOrEqual(0);
    expect(track).toBeLessThan(360);
  });

  it('normalizes 000/360 correctly', () => {
    expect(normalizeDegrees(360)).toBe(0);
    expect(normalizeDegrees(-1)).toBe(359);
    expect(normalizeDegrees(721)).toBe(1);
  });
});
