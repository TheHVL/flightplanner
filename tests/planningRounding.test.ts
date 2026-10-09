import { describe, expect, it } from 'vitest';
import {
  ceilFuelUsageGal,
  roundLegDistanceNm,
  ceilPlanningMinutes,
  formatPlanningTime,
} from '../src/presentation/planningRounding';

describe('planning display rounding', () => {
  it('rounds calculated time upward to the nearest whole minute', () => {
    expect(ceilPlanningMinutes(0)).toBe(0);
    expect(ceilPlanningMinutes(5)).toBe(5);
    expect(ceilPlanningMinutes(5.01)).toBe(6);
    expect(ceilPlanningMinutes(59.1)).toBe(60);
    expect(formatPlanningTime(65.01)).toBe('1:06');
  });

  it('rounds fuel usage upward to the nearest whole US gallon', () => {
    expect(ceilFuelUsageGal(0)).toBe(0);
    expect(ceilFuelUsageGal(1)).toBe(1);
    expect(ceilFuelUsageGal(1.01)).toBe(2);
    expect(ceilFuelUsageGal(1.6)).toBe(2);
  });

  it('rounds fractional NM below 0.3 down and 0.3 or above up', () => {
    for (const [exact, displayed] of [[0,0], [0.29,0], [0.3,1], [12,12], [12.01,12], [12.299,12], [12.3,13], [12.5,13], [12.99,13], [5.7,6], [7.2,7]]) {
      expect(roundLegDistanceNm(exact)).toBe(displayed);
    }
    for (const invalid of [-1, NaN, Infinity]) expect(() => roundLegDistanceNm(invalid)).toThrow();
  });

  it('does not bump values that only differ from an integer by floating-point noise', () => {
    expect(ceilPlanningMinutes(6.000000000000001)).toBe(6);
    expect(ceilFuelUsageGal(2.000000000000001)).toBe(2);
    expect(roundLegDistanceNm(12.000000000000001)).toBe(12);
    expect(roundLegDistanceNm(12.3 - Number.EPSILON * 12)).toBe(13);
  });
});
