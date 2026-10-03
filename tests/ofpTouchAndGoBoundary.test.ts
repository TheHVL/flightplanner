import { describe, expect, it } from 'vitest';
import { isOfpTouchAndGoBoundary } from '../src/components/ofpTouchAndGoBoundary';

describe('OFP touch-and-go boundary', () => {
  it('adds a sector separator only for Airport / T&G mode', () => {
    expect(isOfpTouchAndGoBoundary('airport')).toBe(true);
    expect(isOfpTouchAndGoBoundary('auto')).toBe(false);
    expect(isOfpTouchAndGoBoundary('circuits')).toBe(false);
    expect(isOfpTouchAndGoBoundary('none')).toBe(false);
  });
});
