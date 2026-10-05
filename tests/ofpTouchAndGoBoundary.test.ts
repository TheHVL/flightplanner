import { describe, expect, it } from 'vitest';
import { isOfpTouchAndGoBoundary } from '../src/components/ofpTouchAndGoBoundary';

describe('OFP touch-and-go boundary', () => {
  it('adds a sector separator for airport visits with or without pattern', () => {
    expect(isOfpTouchAndGoBoundary('airport')).toBe(true);
    expect(isOfpTouchAndGoBoundary('auto')).toBe(false);
    expect(isOfpTouchAndGoBoundary('circuits')).toBe(true);
    expect(isOfpTouchAndGoBoundary('none')).toBe(false);
  });
});
