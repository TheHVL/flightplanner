// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GeneratorPage } from '../src/generator/GeneratorPage';
import { generatorFixture, generatorNow, generatorRaster } from './helpers/generatorFixture.mjs';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { saveWorkingRoute } from '../src/flightplan/workingRoutePersistence';
const map = vi.hoisted(() => ({ calls: [] }));
vi.mock('../src/generator/GeneratorMap', () => ({ GeneratorMap: class { show(candidates, selected) { map.calls.push({ candidates, selected }); } } }));
let terrainMode = 'normal', resolvers = [];
vi.mock('../src/routing/terrainRaster', async importOriginal => ({ ...await importOriginal(),
  fetchRouteTerrainRaster: vi.fn(async (_points, signal) => {
    if (terrainMode === 'pending') await new Promise(resolve => resolvers.push(resolve));
    signal.throwIfAborted(); return generatorRaster();
  }),
}));
beforeEach(() => {
  vi.setConfig({ testTimeout: 15000 });
  localStorage.clear(); sessionStorage.clear(); map.calls = []; terrainMode = 'normal'; resolvers = [];
  vi.setSystemTime(generatorNow);
  const { catalog, refresh } = generatorFixture();
  const radio = JSON.parse(readFileSync('tests/fixtures/aip/northern-radio-areas.json', 'utf8'));
  radio.checkedAt = generatorNow.toISOString(); radio.effectiveDate = catalog.effectiveDate; radio.nextEffectiveDate = catalog.nextEffectiveDate;
  vi.stubGlobal('fetch', vi.fn(async input => {
    const url = String(input);
    if (url.includes('hoydedata')) {
      const points = JSON.parse(new URL(url).searchParams.get('punkter'));
      const response = () => new Response(JSON.stringify({ koordsys: 4258, punkter: terrainMode === 'missing' ? [] : points.map(([x,y]) => ({ x, y, z: terrainMode === 'mountain' ? 4000 : 0, datakilde: 'dtm1', terreng: 'Skog' })) }));
      if (terrainMode === 'pending') return new Promise(resolve => resolvers.push(() => resolve(response())));
      return response();
    }
    return new Response(JSON.stringify(url.includes('aip-frequencies.json') ? radio : url.includes('status.json') ? refresh : catalog));
  }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
function page() {
  const root = document.createElement('div'); document.body.replaceChildren(root); new GeneratorPage(root); return root;
}
const waitReady = async root => vi.waitFor(() => expect(root.querySelector('[data-generator-status]').textContent).toContain('Choose your lesson'));
const submit = root => root.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
it('mounts a separate workflow, generates alternatives and preserves the manual working route', async () => {
  const manual = new FlightPlanStore(), shapes = new RouteShapeController(manual); manual.addWaypoint({ lat: 69, lon: 18 }, 'Existing manual point'); saveWorkingRoute(manual, shapes);
  const before = localStorage.getItem('flightplanner-working-route-v1');
  const root = page(); await waitReady(root);
  expect(root.querySelector('#sequential-leg-panel')).toBeNull(); expect(root.querySelector('#ofp-table')).toBeNull();
  expect(root.querySelector('a[aria-current="page"]').textContent).toBe('Route Generator');
  expect([...root.querySelector('select[name="departure"]').options].map(o=>o.value)).toEqual(['ENDU','ENSR','ENTC']);
  submit(root);
  await vi.waitFor(() => expect(root.querySelector('[data-generator-status]').textContent).toContain('available for chart review'), { timeout: 10000 });
  expect(root.querySelectorAll('.generator-candidate').length).toBeGreaterThan(1);
  expect(localStorage.getItem('flightplanner-working-route-v1')).toBe(before);
  expect(sessionStorage.length).toBe(0);
  expect(root.querySelector('[data-generator-transfer]').disabled).toBe(false);
  const altitude = root.querySelector('[name="altitudeFt"]'); altitude.value = '4000'; altitude.dispatchEvent(new Event('input', { bubbles: true }));
  expect(root.querySelectorAll('.generator-candidate')).toHaveLength(0);
  expect(localStorage.getItem('flightplanner-working-route-v1')).toBe(before);
});
it('shows airport-only pattern controls and preserves visit order through reordering', async () => {
  const root = page(); await waitReady(root);
  const activity = root.querySelector('[data-visit-activity]'); activity.value = 'patterns'; activity.dispatchEvent(new Event('change', { bubbles: true }));
  expect(root.querySelector('[data-visit-count]')).not.toBeNull();
  const count = root.querySelector('[data-visit-count]'); count.value = '2';
  root.querySelector('[aria-label="Move visit 1 down"]').click();
  expect([...root.querySelectorAll('[data-visit-airport]')].map(s=>s.value)).toEqual(['ENSR','ENTC']);
  expect(root.querySelector('[data-visit-count]').value).toBe('2');
  submit(root);
  await vi.waitFor(() => expect(root.querySelector('[data-generator-status]').textContent).toContain('available for chart review'), { timeout: 10000 });
  expect(root.textContent).toContain('incl. 10 min pattern');
});
it('blocks transferring terrain-conflicting drafts and cancels old results after an edit', async () => {
  const root = page(); await waitReady(root); terrainMode = 'mountain'; submit(root);
  await vi.waitFor(() => expect(root.querySelector('[data-generator-status]').textContent).toContain('No draft meets'), { timeout: 10000 });
  expect(root.querySelector('[data-generator-transfer]').disabled).toBe(true);
  terrainMode = 'pending'; submit(root);
  await vi.waitFor(() => expect(resolvers.length).toBeGreaterThan(0));
  const altitude = root.querySelector('[name="altitudeFt"]'); altitude.value = '5000'; altitude.dispatchEvent(new Event('input', { bubbles: true }));
  resolvers.forEach(resolve=>resolve());
  await Promise.resolve(); await Promise.resolve();
  expect(root.querySelector('[data-generator-status]').textContent).toContain('Inputs changed');
  expect(root.querySelector('[data-generator-transfer]')).toBeNull();
});
it('keeps missing terrain visibly incomplete and blocks transfer until it can be checked', async () => {
  const root = page(); await waitReady(root); terrainMode = 'missing'; submit(root);
  await vi.waitFor(() => expect(root.querySelector('[data-generator-status]').textContent).toContain('No draft meets'), { timeout: 10000 });
  expect(root.querySelector('.generator-check-state').textContent).toContain('Terrain check incomplete');
  expect(root.textContent).not.toContain('No low transit margin found');
  expect(root.querySelector('[data-generator-transfer]').disabled).toBe(true);
  expect(sessionStorage.length).toBe(0);
});
