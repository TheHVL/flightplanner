import { describe, expect, it } from 'vitest';
import { parsePublishedRestrictions } from '../scripts/aip/parseRestrictions.mjs';
import { validateRadioCatalog } from '../src/frequencies/catalog';
import { generatorRadioFixture } from './helpers/generatorFixture.mjs';
const url = 'https://aim-prod.avinor.no/no/AIP/ENR-5.1';
const table = rows => `<table>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</table>`;
describe('published ENR 5.1 restriction importer', () => {
  it('retains published polygon limits and circle footprints without inventing activation', () => {
    const data = parsePublishedRestrictions(table([
      ['END471', 'Falkefjell 690620N 0185055E - 690815N 0190405E - 690357N 0191514E - 690448N 0190337E - (690620N 0185055E)', 'Upper limit: FL 200 Lower limit: GND', 'MIL activity'],
      ['ENR424', 'Grøtsund 694446N 0190818E - A circle with radius 1.0 NM', 'Upper limit: 1000 FT AMSL Lower limit: GND', 'Check published conditions'],
    ]), url);
    expect(data.publishedAreaCount).toBe(2); expect(data.warnings).toEqual([]);
    expect(data.areas.map(a => a.activation)).toEqual(['unknown', 'unknown']);
    expect(data.areas[0].volumes[0].upper).toEqual({ reference: 'FL', value: 20000 });
    const circle = data.areas[1].volumes[0].polygon;
    expect(circle).toHaveLength(181); expect(circle[0]).toEqual(circle.at(-1));
    expect(circle[0][1]).toBeGreaterThan(69 + 44 / 60 + 46 / 3600 + 1852 / 6371008.8 * 180 / Math.PI);
  });
  it('retains unsupported sectors and NOTAM-only vertical limits as conservative review footprints', () => {
    const data = parsePublishedRestrictions(table([
      ['END477', 'R og B 2 691719N 0160133E - Sector 291° - 020° (T), radius 12 - 39 NM', 'Upper limit: UNL Lower limit: MSL', 'Real time activation, 30 MIN notice'],
      ['ENR109', 'Romerike 1 600300N 0105300E - 600000N 0111300E - 595845N 0110000E - (600300N 0105300E)', 'Lower limit: GND', 'Elevations published in NOTAM'],
    ]), url);
    expect(data.areas).toHaveLength(2); expect(data.areas[0].unresolvedGeometry).toBe(true);
    expect(data.areas[1].unresolvedGeometry).toBeUndefined();
    expect(data.areas[0].volumes[0].lower).toEqual({ reference: 'AMSL', value: 0 });
    expect(data.areas[0].volumes[0].polygon[0][1]).toBeLessThan(69 - 0.3);
    expect(data.areas[1].verticalLimitsUnknown).toBe(true);
    expect(data.areas[1].volumes[0].publishedLimits).toBe('Lower limit: GND');
    expect(data.warnings).toHaveLength(2);
  });
  it('fails a source with an unlocated or duplicate area instead of silently omitting it', () => {
    expect(() => parsePublishedRestrictions(table([['ENR999', 'Unknown location', 'Lower limit: GND', '']]), url)).toThrow('location');
    const row = ['ENR999', 'Test 600000N 0100000E - A circle with radius 1 NM', 'Upper limit: 1000 FT AMSL Lower limit: GND', ''];
    expect(() => parsePublishedRestrictions(table([row, row]), url)).toThrow('Duplicate');
    expect(() => parsePublishedRestrictions('<table></table>', url)).toThrow('No published');
  });
  it('rejects incomplete restriction arrays, a guessed activation state and changed provenance', () => {
    const radio = generatorRadioFixture(); expect(() => validateRadioCatalog(radio)).not.toThrow();
    expect(() => validateRadioCatalog({ ...radio, restrictions: [] })).toThrow('coverage');
    const altered = structuredClone(radio); altered.restrictions[0].activation = 'inactive';
    expect(() => validateRadioCatalog(altered)).toThrow('invalid area');
    altered.restrictions[0].activation = 'unknown'; altered.restrictions[0].sourceUrl = 'https://example.com';
    expect(() => validateRadioCatalog(altered)).toThrow('invalid area');
  });
});
