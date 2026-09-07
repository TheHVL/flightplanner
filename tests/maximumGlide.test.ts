import { describe, expect, it } from 'vitest';
import {
  C182T_BEST_GLIDE_SPEEDS,
  maximumGlideDistanceNm,
} from '../src/performance/maximumGlide';

describe('C182T maximum glide Figure 3-1 model', () => {
  it('matches the approximate straight chart line through 14,000 ft and 20 NM', () => {
    expect(maximumGlideDistanceNm(0)).toBe(0);
    expect(maximumGlideDistanceNm(700)).toBeCloseTo(1, 8);
    expect(maximumGlideDistanceNm(4500)).toBeCloseTo(6.428571, 5);
    expect(maximumGlideDistanceNm(14_000)).toBeCloseTo(20, 8);
  });

  it('does not extrapolate beyond the plotted chart height', () => {
    expect(() => maximumGlideDistanceNm(14_001)).toThrow(/only represented through/i);
  });

  it('records the three best-glide speeds printed in the POH figure', () => {
    expect(C182T_BEST_GLIDE_SPEEDS).toEqual([
      { weightLb: 3100, kias: 76 },
      { weightLb: 2600, kias: 70 },
      { weightLb: 2100, kias: 58 },
    ]);
  });
});
