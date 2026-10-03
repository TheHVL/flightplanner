import { describe, expect, it } from 'vitest';
import {
  ceilFuelUsageGal,
  ceilLegDistanceNm,
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

  it('rounds individual OFP leg distance upward to the nearest whole NM', () => {
    expect(ceilLegDistanceNm(0)).toBe(0);
    expect(ceilLegDistanceNm(12)).toBe(12);
    expect(ceilLegDistanceNm(12.01)).toBe(13);
    expect(ceilLegDistanceNm(12.5)).toBe(13);
    expect(ceilLegDistanceNm(12.99)).toBe(13);
  });

  it('does not bump values that only differ from an integer by floating-point noise', () => {
    expect(ceilPlanningMinutes(6.000000000000001)).toBe(6);
    expect(ceilFuelUsageGal(2.000000000000001)).toBe(2);
    expect(ceilLegDistanceNm(12.000000000000001)).toBe(12);
  });
});
