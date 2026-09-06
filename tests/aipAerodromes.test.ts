import { describe, expect, it } from 'vitest';
import {
  findAipAerodromeInCatalog,
  normalizeIcao,
  type AipAerodromeCatalog,
} from '../src/aip/aerodromes';

const catalog: AipAerodromeCatalog = {
  source: 'Avinor AIP Norway',
  effectiveDate: '2026-06-11',
  generatedAt: '2026-09-06T00:00:00Z',
  issueUrl: 'https://example.invalid/aip',
  aerodromes: [
    {
      icao: 'ENDU',
      name: 'BARDUFOSS',
      elevationFt: 254,
      lat: 69.055833,
      lon: 18.540278,
      sourceUrl: 'https://example.invalid/endu',
    },
  ],
};

describe('AIP aerodrome catalog', () => {
  it('normalizes ICAO input', () => {
    expect(normalizeIcao(' endu ')).toBe('ENDU');
    expect(normalizeIcao('en-du')).toBe('ENDU');
  });

  it('finds an aerodrome and its published elevation by ICAO code', () => {
    const aerodrome = findAipAerodromeInCatalog(catalog, 'endu');
    expect(aerodrome?.icao).toBe('ENDU');
    expect(aerodrome?.elevationFt).toBe(254);
  });

  it('does not guess when a code is absent', () => {
    expect(findAipAerodromeInCatalog(catalog, 'ENTC')).toBeNull();
    expect(findAipAerodromeInCatalog(catalog, 'END')).toBeNull();
  });
});
