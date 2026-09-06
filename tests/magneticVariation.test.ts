import { describe, expect, it } from 'vitest';
import {
  automaticVariationForLeg,
  roundVariationDeg,
  routeLegMidpoint,
} from '../src/navigation/magneticVariation';
import type { RouteLeg } from '../src/types';

const leg: RouteLeg = {
  index: 0,
  from: { id: 'a', name: 'A', lat: 69.6492, lon: 18.9553 },
  to: { id: 'b', name: 'B', lat: 69.0689, lon: 18.5156 },
  distanceNm: 0,
  trueTrackDeg: 0,
};

describe('automatic magnetic variation', () => {
  it('uses a geographic midpoint for the leg', () => {
    const midpoint = routeLegMidpoint(leg);
    expect(midpoint.lat).toBeGreaterThan(69.0);
    expect(midpoint.lat).toBeLessThan(69.7);
    expect(midpoint.lon).toBeGreaterThan(18.4);
    expect(midpoint.lon).toBeLessThan(19.0);
  });

  it('returns a plausible east variation for northern Norway using WMM2025', () => {
    const result = automaticVariationForLeg(leg, 2026.5);
    expect(Number.isFinite(result.variationDegEast)).toBe(true);
    expect(result.variationDegEast).toBeGreaterThan(0);
    expect(result.variationDegEast).toBeLessThan(30);
  });

  it('rounds east and west variation to whole degrees symmetrically', () => {
    expect(roundVariationDeg(7.4)).toBe(7);
    expect(roundVariationDeg(7.5)).toBe(8);
    expect(roundVariationDeg(-7.4)).toBe(-7);
    expect(roundVariationDeg(-7.5)).toBe(-8);
  });
});
