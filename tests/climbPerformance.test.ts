import { describe, expect, it } from 'vitest';
import { calculateC182TClimb } from '../src/performance/climbPerformance';

describe('C182T Figure 5-8 climb performance', () => {
  it('reproduces the normal-climb sea-level to 4000 ft table values', () => {
    const result = calculateC182TClimb({
      profile: 'normal-90',
      startPressureAltitudeFt: 0,
      endPressureAltitudeFt: 4000,
      oatC: 7,
    });

    expect(result.timeMin).toBeCloseTo(6, 8);
    expect(result.fuelUsedGal).toBeCloseTo(1.6, 8);
    expect(result.distanceNm).toBeCloseTo(10, 8);
    expect(result.targetClimbSpeedKias).toBeCloseTo(90, 8);
    expect(result.targetRateOfClimbFpm).toBeCloseTo(580, 8);
    expect(result.temperatureCorrectionFactor).toBe(1);
  });

  it('subtracts cumulative table values for a climb that begins above sea level', () => {
    const result = calculateC182TClimb({
      profile: 'max-rate',
      startPressureAltitudeFt: 2000,
      endPressureAltitudeFt: 6000,
      oatC: 3,
    });

    expect(result.timeMin).toBeCloseTo(6, 8);
    expect(result.fuelUsedGal).toBeCloseTo(1.5, 8);
    expect(result.distanceNm).toBeCloseTo(8, 8);
  });

  it('interpolates between published pressure-altitude rows', () => {
    const result = calculateC182TClimb({
      profile: 'normal-90',
      startPressureAltitudeFt: 0,
      endPressureAltitudeFt: 3000,
      oatC: 9,
    });

    expect(result.timeMin).toBeCloseTo(4.5, 8);
    expect(result.fuelUsedGal).toBeCloseTo(1.2, 8);
    expect(result.distanceNm).toBeCloseTo(7.5, 8);
  });

  it('applies the POH 10 percent per 10C above standard correction', () => {
    const result = calculateC182TClimb({
      profile: 'normal-90',
      startPressureAltitudeFt: 0,
      endPressureAltitudeFt: 4000,
      oatC: 17,
    });

    expect(result.temperatureAboveStandardC).toBeCloseTo(10, 8);
    expect(result.temperatureCorrectionFactor).toBeCloseTo(1.1, 8);
    expect(result.timeMin).toBeCloseTo(6.6, 8);
    expect(result.fuelUsedGal).toBeCloseTo(1.76, 8);
    expect(result.distanceNm).toBeCloseTo(11, 8);
  });

  it('does not reduce values below standard temperature', () => {
    const result = calculateC182TClimb({
      profile: 'max-rate',
      startPressureAltitudeFt: 0,
      endPressureAltitudeFt: 4000,
      oatC: -10,
    });

    expect(result.temperatureCorrectionFactor).toBe(1);
    expect(result.timeMin).toBe(5);
    expect(result.fuelUsedGal).toBe(1.5);
    expect(result.distanceNm).toBe(7);
  });

  it('refuses to extrapolate normal climb above 10000 ft', () => {
    expect(() => calculateC182TClimb({
      profile: 'normal-90',
      startPressureAltitudeFt: 0,
      endPressureAltitudeFt: 12000,
      oatC: -9,
    })).toThrow(/10,000 ft pressure altitude/i);
  });
});
