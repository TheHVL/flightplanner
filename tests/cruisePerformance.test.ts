import { describe, expect, it } from 'vitest';
import { calculateCruisePerformance } from '../src/performance/cruisePerformance';

describe('C182T cruise performance Figure 5-9', () => {
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

  it('reproduces exact points from the newly loaded altitude sheets', () => {
    const at4000 = calculateCruisePerformance({
      pressureAltitudeFt: 4000,
      oatC: 7,
      rpm: 2300,
      manifoldPressureInHg: 23,
    });
    expect(at4000.percentMcp).toBe(74);
    expect(at4000.ktas).toBe(137);
    expect(at4000.fuelFlowGph).toBe(12.8);

    const at8000Hot = calculateCruisePerformance({
      pressureAltitudeFt: 8000,
      oatC: 19,
      rpm: 2100,
      manifoldPressureInHg: 18,
    });
    expect(at8000Hot.percentMcp).toBe(49);
    expect(at8000Hot.ktas).toBe(115);
    expect(at8000Hot.fuelFlowGph).toBe(9.2);

    const at14000 = calculateCruisePerformance({
      pressureAltitudeFt: 14000,
      oatC: -13,
      rpm: 2400,
      manifoldPressureInHg: 15,
    });
    expect(at14000.percentMcp).toBe(48);
    expect(at14000.ktas).toBe(117);
    expect(at14000.fuelFlowGph).toBe(9.1);
  });

  it('interpolates between altitude tables', () => {
    const result = calculateCruisePerformance({
      pressureAltitudeFt: 5000,
      oatC: 5,
      rpm: 2300,
      manifoldPressureInHg: 23,
    });

    expect(result.percentMcp).toBeCloseTo(75, 5);
    expect(result.ktas).toBeCloseTo(139, 5);
    expect(result.fuelFlowGph).toBeCloseTo(12.95, 5);
    expect(result.temperatureOffsetC).toBeCloseTo(0, 5);
  });

  it('interpolates between sea-level and 2,000 ft tables', () => {
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

  it('interpolates between the 12,000 and 14,000 ft tables without extrapolating', () => {
    const result = calculateCruisePerformance({
      pressureAltitudeFt: 13000,
      oatC: -11,
      rpm: 2300,
      manifoldPressureInHg: 16,
    });

    expect(result.percentMcp).toBeCloseTo(50.5, 5);
    expect(result.ktas).toBeCloseTo(120, 5);
    expect(result.fuelFlowGph).toBeCloseTo(9.45, 5);
  });

  it('refuses altitude, RPM and MP extrapolation beyond published Figure 5-9 data', () => {
    expect(() => calculateCruisePerformance({
      pressureAltitudeFt: 15000,
      oatC: -15,
      rpm: 2300,
      manifoldPressureInHg: 16,
    })).toThrow(/14,000 ft/i);

    expect(() => calculateCruisePerformance({
      pressureAltitudeFt: 14000,
      oatC: -13,
      rpm: 2000,
      manifoldPressureInHg: 16,
    })).toThrow(/no figure 5-9 cruise data/i);

    expect(() => calculateCruisePerformance({
      pressureAltitudeFt: 12000,
      oatC: -9,
      rpm: 2400,
      manifoldPressureInHg: 19,
    })).toThrow(/outside the published figure 5-9 range/i);
  });
});
