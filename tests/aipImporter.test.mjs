import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { resolveIssue, parseCoordinate, parseAerodromePage, parseReportingPointBbox, verifiedRoutes } from '../scripts/aip/parse.mjs';
const fixture = name => readFileSync(new URL(`./fixtures/aip/${name}`, import.meta.url), 'utf8');
const sourceUrl = 'https://aim-prod.avinor.no/aip';
describe('Avinor AIP import', () => {
  it('selects the latest effective publication irrespective of page order, retaining the next effective date', () => {
    const html = '<a href="2026-10-29-AIRAC/html/index-no-NO.html">next</a><a href="2026-06-11-AIRAC/html/index-no-NO.html">old</a><a href="2026-09-03-AIRAC/html/index-no-NO.html">current</a>';
    const issue = resolveIssue(html, 'https://aim-prod.avinor.no/no/AIP/View/Index/155/history-no-NO.html', '2026-10-05');
    expect(issue.effectiveDate).toBe('2026-09-03');
    expect(issue.nextEffectiveDate).toBe('2026-10-29');
    expect(issue.issueRoot).toContain('/Index/155/2026-09-03-AIRAC/html/');
  });
  it('rejects impossible DMS coordinates', () => {
    expect(parseCoordinate('699999N')).toBeNull();
    expect(parseCoordinate('910000N')).toBeNull();
    expect(parseCoordinate('691425N')).toBeCloseTo(69.24027778);
  });
  it('imports reciprocal runway rowspans and service designations from a real Avinor excerpt', () => {
    const ad = parseAerodromePage('ENAN', fixture('enan-sections.html'), sourceUrl);
    expect(ad.runways.map(rwy => rwy.designator)).toEqual(['14', '32']);
    expect(ad.runways[1].lengthM).toBe(1989);
    expect(ad.runways[1].todaM).toBe(2437);
    expect(ad.frequencies[0].service).toBe('ATIS');
    expect(ad.frequencies[0].frequencyMHz).toBe('136.130');
    expect(ad.frequencies[1].service).toBe('TWR');
    expect(ad.transitionAltitudeFt).toBe(7000);
  });
  it('ignores deleted AIRAC values and hidden source annotations', () => {
    const html = fixture('enan-sections.html').replace('136.130', '<del class="AmdtDeletedAIRAC">136.125</del><ins>136.130</ins>');
    expect(parseAerodromePage('ENAN', html, sourceUrl).frequencies[0].frequencyMHz).toBe('136.130');
  });
  it('reads all 20 Bardufoss coordinate rows despite PDF reading order and map labels', () => {
    const points = parseReportingPointBbox('ENDU', fixture('endu-table-bbox.html'), sourceUrl);
    expect(points).toHaveLength(20);
    expect(points.find(point => point.name === 'ESPENES').lat).toBeCloseTo(69.12);
    expect(points.find(point => point.name === 'FINNSNES').lon).toBeCloseTo(17.965);
  });
  it('excludes underlying terrain elevations from Tromsø point names', () => {
    const points = parseReportingPointBbox('ENTC', fixture('entc-table-bbox.html'), sourceUrl);
    expect(points).toHaveLength(13);
    expect(points.map(point => point.name)).toContain('NIPØYA');
    expect(points.map(point => point.name)).toContain('HÅKØYA');
    expect(points.map(point => point.name)).toContain('BREIVIKA');
    expect(points.every(point => !/^\d/.test(point.name))).toBe(true);
  });
  it('withholds a verified route when the chart checksum changes or a referenced point disappears', () => {
    const definitions = [{ id:'west', name:'West', aerodromeIcao:'ENDU', chartSha256:'reviewed', pointNames:['FINNSNES','SØRREISA'] }];
    const points = parseReportingPointBbox('ENDU', fixture('endu-table-bbox.html'), sourceUrl);
    const charts = [{ aerodromeIcao:'ENDU', sha256:'reviewed', sourceUrl }];
    expect(verifiedRoutes(definitions, charts, points)).toHaveLength(1);
    expect(verifiedRoutes(definitions, [{ ...charts[0], sha256:'changed' }], points)).toEqual([]);
    expect(verifiedRoutes(definitions, charts, [])).toEqual([]);
  });
});
