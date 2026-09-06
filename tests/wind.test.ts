import { describe, expect, it } from 'vitest';
import { normalizeHeading, solveWindTriangle, trueToMagnetic } from '../src/navigation/wind';

describe('wind triangle', () => {
  it('returns TAS as GS in calm wind', () => {
    const result = solveWindTriangle({
      trueTrackDeg: 90,
      tasKt: 130,
      windFromDeg: 0,
      windSpeedKt: 0,
    });

    expect(result.wcaDeg).toBeCloseTo(0, 6);
    expect(result.trueHeadingDeg).toBeCloseTo(90, 6);
    expect(result.groundSpeedKt).toBeCloseTo(130, 6);
  });

  it('corrects into a crosswind', () => {
    const result = solveWindTriangle({
      trueTrackDeg: 0,
      tasKt: 100,
      windFromDeg: 90,
      windSpeedKt: 20,
    });

    expect(result.wcaDeg).toBeCloseTo(11.537, 3);
    expect(result.trueHeadingDeg).toBeCloseTo(11.537, 3);
    expect(result.groundSpeedKt).toBeCloseTo(97.98, 2);
  });

  it('reduces groundspeed in a headwind', () => {
    const result = solveWindTriangle({
      trueTrackDeg: 180,
      tasKt: 120,
      windFromDeg: 180,
      windSpeedKt: 25,
    });

    expect(result.wcaDeg).toBeCloseTo(0, 6);
    expect(result.groundSpeedKt).toBeCloseTo(95, 6);
  });

  it('converts true to magnetic with east variation subtracted', () => {
    expect(trueToMagnetic(170, 7)).toBeCloseTo(163, 6);
    expect(trueToMagnetic(5, 7)).toBeCloseTo(358, 6);
  });

  it('normalizes headings to 0 through 360', () => {
    expect(normalizeHeading(-5)).toBe(355);
    expect(normalizeHeading(365)).toBe(5);
  });

  it('rejects wind that makes the desired track impossible', () => {
    expect(() => solveWindTriangle({
      trueTrackDeg: 0,
      tasKt: 50,
      windFromDeg: 90,
      windSpeedKt: 60,
    })).toThrow(/too strong/i);
  });
});
