import { describe, expect, it } from 'vitest';
import { WindTriangleCalculator } from '../src/navigation/WindTriangleCalculator';

const calculator = new WindTriangleCalculator();

describe('WindTriangleCalculator', () => {
  it('applies a headwind without changing heading', () => {
    const result = calculator.calculate({ trueTrackDeg: 0, tasKt: 120, windFromDegTrue: 0, windSpeedKt: 20 });
    expect(result.wcaDeg).toBeCloseTo(0, 8);
    expect(result.groundspeedKt).toBeCloseTo(100, 8);
  });

  it('applies a tailwind without changing heading', () => {
    const result = calculator.calculate({ trueTrackDeg: 0, tasKt: 120, windFromDegTrue: 180, windSpeedKt: 20 });
    expect(result.wcaDeg).toBeCloseTo(0, 8);
    expect(result.groundspeedKt).toBeCloseTo(140, 8);
  });

  it('corrects into a right-hand crosswind', () => {
    const result = calculator.calculate({ trueTrackDeg: 0, tasKt: 120, windFromDegTrue: 90, windSpeedKt: 20 });
    expect(result.wcaDeg).toBeGreaterThan(0);
    expect(result.wcaDeg).toBeCloseTo(9.594, 3);
    expect(result.trueHeadingDeg).toBeCloseTo(9.594, 3);
    expect(result.groundspeedKt).toBeCloseTo(118.322, 3);
  });

  it('corrects into a left-hand crosswind', () => {
    const result = calculator.calculate({ trueTrackDeg: 0, tasKt: 120, windFromDegTrue: 270, windSpeedKt: 20 });
    expect(result.wcaDeg).toBeLessThan(0);
    expect(result.trueHeadingDeg).toBeGreaterThan(350);
  });
});
