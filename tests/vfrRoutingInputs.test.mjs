import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { verifiedRoutes } from '../scripts/aip/parse.mjs';
import { buildVfrRoutingInputs } from '../src/routing/vfrInputs';
import { validateAipCatalog } from '../src/aip/aerodromes';
const definitions = JSON.parse(readFileSync('scripts/aip/verified-vfr-routes.json', 'utf8'));
// Fixed reviewed-edition fixture: a future AIP change may legitimately withhold
// graph edges without turning the daily data refresh into a test failure.
const snapshot = JSON.parse(readFileSync('tests/fixtures/aip/northern-routing.json', 'utf8'));
const charts = snapshot.aerodromes.flatMap(a => (a.charts ?? []).map(c => ({ ...c, aerodromeIcao: a.icao })));
const now = new Date('2026-10-06T12:00:00Z');
const catalog = { ...snapshot, effectiveDate: '2026-09-03', nextEffectiveDate: '2026-10-29', checkedAt: now.toISOString(),
  vfrRoutes: verifiedRoutes(definitions, charts, snapshot.reportingPoints) };
const status = { state: 'success', attemptedAt: now.toISOString(), effectiveDate: catalog.effectiveDate };
describe('generator VFR data foundation', () => {
  it('carries the Berg–Breivika MAX 1000 constraint with verified chart provenance', () => {
    const data = buildVfrRoutingInputs(catalog, status, '2026-10-06', now);
    const edge = data.edges.find(e => e.fromId === 'ENTC:BERG' && e.toId === 'ENTC:BREIVIKA');
    expect(edge).toMatchObject({ maxAltitudeFt: 1000, requiresChartReview: true, effectiveDate: '2026-09-03' });
    expect(edge.chartSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.readyForAutomaticRouting).toBe(false);
    expect(data.edges.some(e => e.fromId === 'ENTC' || e.toId === 'ENTC')).toBe(false);
  });
  it('preserves directed chart limits and does not invent a Tønsnes–Movikvann connection', () => {
    const data = buildVfrRoutingInputs(catalog, status, '2026-10-06', now);
    expect(data.edges.find(e => e.fromId === 'ENTC:NIPØYA' && e.toId === 'ENTC:TØNSNES').maxAltitudeFt).toBe(1000);
    expect(data.edges.find(e => e.fromId === 'ENTC:TØNSNES' && e.toId === 'ENTC:NIPØYA').maxAltitudeFt).toBe(2500);
    expect(data.edges.some(e => e.fromId === 'ENTC:MUSVÆR' && e.toId === 'ENTC:RAKNES')).toBe(false);
    expect(data.edges.some(e => [e.fromId, e.toId].includes('ENTC:MOVIKVANN'))).toBe(false);
    expect(data.edges.some(e => e.routeId.startsWith('ENSR:'))).toBe(false);
    expect(data.coverageWarnings.join(' ')).toContain('chart altitude requires review');
  });
  it('withholds changed chart checksums, missing points and malformed limits', () => {
    const definition = definitions.find(d => d.id === 'ENTC:4');
    expect(verifiedRoutes([definition], charts.map(c => ({ ...c, sha256: 'changed' })), snapshot.reportingPoints)).toEqual([]);
    expect(verifiedRoutes([definition], charts, snapshot.reportingPoints.filter(p => p.id !== 'ENTC:BERG'))).toEqual([]);
    expect(verifiedRoutes([{ ...definition, segments: [{ maxAltitudeFt: -1, direction: 'both' }, definition.segments[1]] }], charts, snapshot.reportingPoints)).toEqual([]);
    const invalid = structuredClone(catalog); invalid.vfrRoutes[0].segments[0].toPointId = 'ENTC:BERG';
    expect(() => validateAipCatalog(invalid)).toThrow('reviewed route limits');
    const changed = structuredClone(catalog); changed.aerodromes.find(a => a.icao === 'ENTC').charts.forEach(c => { c.sha256 = 'changed'; });
    expect(buildVfrRoutingInputs(changed, status, '2026-10-06', now).edges.some(e => e.routeId.startsWith('ENTC:'))).toBe(false);
  });
  it('withholds outdated sources, future check timestamps and flights outside the AIP edition', () => {
    for (const [data, flightDate, refresh] of [
      [{ ...catalog, checkedAt: '2026-10-03T12:00:00Z' }, '2026-10-06', status],
      [{ ...catalog, checkedAt: '2026-10-07T12:00:00Z' }, '2026-10-06', status],
      [catalog, '2026-10-29', status], [catalog, '2026-08-01', status],
      [catalog, '2026-10-06', null], [catalog, '2026-10-06', { ...status, state: 'failed' }],
    ]) expect(buildVfrRoutingInputs(data, refresh, flightDate, now)).toMatchObject({ usable: false, nodes: [], edges: [] });
  });
});
