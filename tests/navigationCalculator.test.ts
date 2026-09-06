import { describe, expect, it } from 'vitest';
import { NavigationCalculator } from '../src/navigation/NavigationCalculator';
import type { RouteLeg } from '../src/types';

const leg: RouteLeg = {
  index: 0,
  from: { id: 'a', name: 'A', lat: 0, lon: 0 },
  to: { id: 'b', name: 'B', lat: 1, lon: 0 },
  distanceNm: 60,
  trueTrackDeg: 0,
};

describe('NavigationCalculator', () => {
  it('applies east variation as east-is-least for magnetic values', () => {
    const result = new NavigationCalculator().calculateLegs([leg], {
      tasKt: 120,
      windFromDegTrue: 0,
      windSpeedKt: 0,
      variationDegEastPositive: 6,
      fuelFlowGph: 12,
    })[0];

    expect(result.magneticTrackDeg).toBe(354);
    expect(result.magneticHeadingDeg).toBe(354);
  });

  it('calculates time and fuel from groundspeed', () => {
    const result = new NavigationCalculator().calculateLegs([leg], {
      tasKt: 120,
      windFromDegTrue: 0,
      windSpeedKt: 20,
      variationDegEastPositive: 0,
      fuelFlowGph: 12,
    })[0];

    expect(result.groundspeedKt).toBeCloseTo(100, 8);
    expect(result.timeMinutes).toBeCloseTo(36, 8);
    expect(result.legFuelGal).toBeCloseTo(7.2, 8);
  });
});
