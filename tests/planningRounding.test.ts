import { describe, expect, it } from 'vitest';
import {
  ceilFuelUsageGal,
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

  it('does not bump values that only differ from an integer by floating-point noise', () => {
    expect(ceilPlanningMinutes(6.000000000000001)).toBe(6);
    expect(ceilFuelUsageGal(2.000000000000001)).toBe(2);
  });
});
