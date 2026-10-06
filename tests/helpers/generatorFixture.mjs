import { readFileSync } from 'node:fs';
import { verifiedRoutes } from '../../scripts/aip/parse.mjs';
export const generatorNow = new Date('2026-10-06T12:00:00Z');
export function generatorFixture() {
  const catalog = JSON.parse(readFileSync('tests/fixtures/aip/northern-routing.json', 'utf8'));
  const definitions = JSON.parse(readFileSync('scripts/aip/verified-vfr-routes.json', 'utf8'));
  const charts = catalog.aerodromes.flatMap(a => a.charts.map(c => ({ ...c, aerodromeIcao: a.icao })));
  catalog.vfrRoutes = verifiedRoutes(definitions, charts, catalog.reportingPoints);
  catalog.checkedAt = generatorNow.toISOString(); catalog.nextEffectiveDate = '2026-10-29';
  return { catalog, refresh: { state: 'success', effectiveDate: catalog.effectiveDate, attemptedAt: generatorNow.toISOString() } };
}
export const generatorRequest = { departure: 'ENDU', destination: 'ENDU', visits: [
  { icao: 'ENTC', activity: 'touch-and-go', count: 1, minutesEach: 5 },
  { icao: 'ENSR', activity: 'patterns', count: 2, minutesEach: 5 },
], flightDate: '2026-10-06', lessonMinutes: 90, altitudeFt: 3000, rpm: 2200, manifoldPressureInHg: 20, descentFuelFlowGph: 10, patternFuelFlowGph: 12 };
