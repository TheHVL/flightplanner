import { describe, expect, it } from 'vitest';
import { calculateCruisePerformance } from '../src/performance/cruisePerformance';

describe('C182T cruise performance preview', () => {
  it('reproduces an exact sea-level POH table point', () => {
    const result = calculateCruisePerformance({
      pressureAltitudeFt: 0,
      oatC: 15,
      rpm: 2300,
      manifoldPressureInHg: 23,
    });

    expect(result.percentMcp).toBe(69);
    expect(result.ktas).toBe(128);
    expect(result.fuelFlowGph).toBe(12.0);
  });

  it('interpolates between the sea-level and 2,000 ft tables', () => {
    const result = calculateCruisePerformance({
      pressureAltitudeFt: 1000,
      oatC: 13,
      rpm: 2300,
      manifoldPressureInHg: 23,
    });

    expect(result.percentMcp).toBeCloseTo(70, 5);
    expect(result.ktas).toBeCloseTo(130.5, 5);
    expect(result.fuelFlowGph).toBeCloseTo(12.2, 5);
    expect(result.temperatureOffsetC).toBeCloseTo(0, 5);
  });

  it('interpolates between RPM settings', () => {
    const result = calculateCruisePerformance({
      pressureAltitudeFt: 0,
      oatC: 15,
      rpm: 2250,
      manifoldPressureInHg: 23,
    });

    expect(result.percentMcp).toBeCloseTo(67.5, 5);
    expect(result.ktas).toBeCloseTo(127, 5);
    expect(result.fuelFlowGph).toBeCloseTo(11.85, 5);
  });

  it('refuses to extrapolate beyond the loaded Phase 4 preview tables', () => {
    expect(() => calculateCruisePerformance({
      pressureAltitudeFt: 4000,
      oatC: 7,
      rpm: 2300,
      manifoldPressureInHg: 23,
    })).toThrow(/sea-level and 2,000 ft/i);
  });
});
