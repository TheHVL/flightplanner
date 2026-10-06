import { projectTerrainPoint } from '../../src/routing/terrainRaster';
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

export function generatorRaster() {
  const { catalog } = generatorFixture();
  const points = [...catalog.aerodromes, ...catalog.reportingPoints].map(projectTerrainPoint);
  const resolutionM = 1000, west = Math.floor(Math.min(...points.map(p => p.x)) / resolutionM) * resolutionM - 60000;
  const north = Math.ceil(Math.max(...points.map(p => p.y)) / resolutionM) * resolutionM + 60000;
  const width = Math.ceil((Math.max(...points.map(p => p.x)) + 60000 - west) / resolutionM);
  const height = Math.ceil((north - Math.min(...points.map(p => p.y)) + 60000) / resolutionM);
  return { west, north, resolutionM, width, height, elevationsM: new Float32Array(width * height),
    fetchedAt: generatorNow.toISOString(), sourceUrl: 'https://wcs.geonorge.no/skwms1/wcs.hoyde-dtm-nhm-25833' };
}
