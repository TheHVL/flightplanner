// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { capturePlan, createPlan, parsePlanFile, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { DEFAULT_FUEL_PLANNING_SETTINGS, getFuelPlanningSettings, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { PlanLibraryPanel } from '../src/components/PlanLibraryPanel';
import { WeatherPanel } from '../src/components/WeatherPanel';
import { OFPTable } from '../src/components/OFPTable';
import { fetchForecastSample } from '../src/weather/openMeteo';

vi.mock('../src/weather/openMeteo', () => ({ fetchForecastSample: vi.fn() }));

beforeEach(() => { window.localStorage.clear(); document.body.innerHTML = ''; vi.restoreAllMocks(); });

function route() {
  const store = new FlightPlanStore();
  const shapes = new RouteShapeController(store);
  const a = store.addWaypoint({ lat: 69, lon: 18 }, 'ENDU');
  const b = store.addWaypoint({ lat: 69.6, lon: 19 }, 'ENTC');
  store.updateWaypoint(a.id, { aipId: 'airport-ENDU', aipEffectiveDate: '2026-09-03' });
  shapes.setLegShape(0, { lat: 69.3, lon: 18.1 });
  store.setPlannedAltitudeFt(a.id, b.id, 4500);
  store.setManualMsaFt(a.id, b.id, 3300);
  store.setManualLegWind(a.id, b.id, { windFromDeg: 240, windSpeedKt: 18 });
  store.setWaypointVerticalConstraint(b.id, { mode: 'circuits', elevationFt: 254, icaoCode: 'ENTC', circuitCount: 2, minutesPerCircuit: 6 });
  store.updateNavigationSettings({ tasKt: 115, automaticVariation: false, variationDegEast: 8 });
  store.updatePerformanceSettings({ rpm: 2300, oatC: 5 });
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, totalFuelOnboardGal: 65, climbPerformanceMode: 'manual', climbFuelFlowGph: 17, circuitFuelFlowGph: 13 });
  return { store, shapes, a, b };
}

describe('named plans', () => {
  it('round trips route bends, AIP provenance, leg inputs, circuits, settings and fuel through a file and reload', () => {
    const { store, shapes, a, b } = route();
    const snapshot = capturePlan(store, shapes);
    const distance = store.getLegs()[0].distanceNm;
    const repository = new SavedPlanRepository(window.localStorage);
    const saved = repository.save('Training', snapshot);
    const exported = parsePlanFile(JSON.stringify(saved));
    expect(exported).toEqual(saved);
    const imported = repository.importFile(JSON.stringify(exported));
    expect(imported.id).not.toBe(saved.id);
    expect(imported.name).toBe('Training (2)');
    const reloaded = new SavedPlanRepository(window.localStorage);
    expect(reloaded.list()).toHaveLength(2);
    const target = new FlightPlanStore();
    const targetShapes = new RouteShapeController(target);
    target.addWaypoint({ lat: 60, lon: 10 }, 'Old route');
    saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, totalFuelOnboardGal: 30 });
    const old = capturePlan(target, targetShapes);
    reloaded.load(imported, target, targetShapes);
    expect(capturePlan(target, targetShapes)).toEqual(snapshot);
    expect(target.getWaypoints()[0]).toMatchObject({ aipId: 'airport-ENDU', aipEffectiveDate: '2026-09-03' });
    expect(target.getManualMsaFt(a.id, b.id)).toBe(3300);
    expect(target.getLegs()[0].distanceNm).toBeCloseTo(distance, 8);
    expect(getFuelPlanningSettings().totalFuelOnboardGal).toBe(65);
    expect(target.getWeatherForecasts()).toEqual([]);
    reloaded.restorePrevious(target, targetShapes);
    expect(capturePlan(target, targetShapes)).toEqual(old);
    reloaded.restorePrevious(target, targetShapes);
    expect(capturePlan(target, targetShapes)).toEqual(snapshot);
  });

  it('keeps saved plans and duplicates independent of later working edits and explicit updates', () => {
    const { store, shapes, a, b } = route();
    const repository = new SavedPlanRepository(window.localStorage);
    const saved = repository.save('Training', capturePlan(store, shapes));
    const copy = repository.duplicate(saved.id);
    store.setPlannedAltitudeFt(a.id, b.id, 5500);
    expect(repository.list().find((plan) => plan.id === saved.id)!.flightPlan.plannedAltitudesFt).toEqual(saved.flightPlan.plannedAltitudesFt);
    const updated = repository.save('Training', capturePlan(store, shapes), saved.id);
    expect(updated.id).toBe(saved.id);
    expect(updated.createdAtUtc).toBe(saved.createdAtUtc);
    expect(repository.list().find((plan) => plan.id === copy.id)!.flightPlan.plannedAltitudesFt).toEqual(saved.flightPlan.plannedAltitudesFt);
    saved.flightPlan.waypoints[0].name = 'Changed externally';
    expect(repository.list().find((plan) => plan.id === copy.id)!.flightPlan.waypoints[0].name).toBe('ENDU');
    expect(() => repository.save('training', capturePlan(store, shapes))).toThrow('already has this name');
  });

  it('rejects invalid imports and unsupported versions without changing saved or working data', () => {
    const { store, shapes } = route();
    const repository = new SavedPlanRepository(window.localStorage);
    const saved = repository.save('Training', capturePlan(store, shapes));
    const before = capturePlan(store, shapes);
    const invalidShape = structuredClone(saved);
    invalidShape.routeShapes[0].toId = 'unknown';
    const invalidFuel = structuredClone(saved);
    invalidFuel.fuelSettings.climbFuelFlowGph = -1;
    const invalidCoordinate = structuredClone(saved);
    invalidCoordinate.flightPlan.waypoints[0].lat = 200;
    const invalidId = structuredClone(saved);
    invalidId.flightPlan.waypoints[0].id = '" onmouseover="alert(1)';
    for (const contents of ['{', JSON.stringify({ ...saved, schemaVersion: 99 }), JSON.stringify(invalidShape), JSON.stringify(invalidFuel), JSON.stringify(invalidCoordinate), JSON.stringify(invalidId)]) {
      expect(() => repository.importFile(contents)).toThrow();
    }
    expect(() => repository.load(invalidShape, store, shapes)).toThrow('invalid planning data');
    expect(repository.list()).toEqual([saved]);
    expect(capturePlan(store, shapes)).toEqual(before);
  });

  it('leaves the route and saved data intact if saving or the recovery write fails', () => {
    const { store, shapes } = route();
    const repository = new SavedPlanRepository(window.localStorage);
    const saved = repository.save('Training', capturePlan(store, shapes));
    store.clear();
    store.addWaypoint({ lat: 60, lon: 10 }, 'Unsaved');
    const before = capturePlan(store, shapes);
    const unavailable = new SavedPlanRepository({ getItem: (key) => window.localStorage.getItem(key), setItem: () => { throw new Error('Quota exceeded'); } });
    expect(() => unavailable.save('Another', before)).toThrow('Could not save');
    expect(() => unavailable.load(saved, store, shapes)).toThrow('recovery copy');
    expect(capturePlan(store, shapes)).toEqual(before);
    expect(repository.list()).toEqual([saved]);
  });

  it('does not overwrite unreadable saved data', () => {
    const { store, shapes } = route();
    const savedData = '{damaged';
    window.localStorage.setItem('flightplanner-saved-plans-v1', savedData);
    const repository = new SavedPlanRepository(window.localStorage);
    expect(() => repository.save('Training', capturePlan(store, shapes))).toThrow('kept');
    expect(window.localStorage.getItem('flightplanner-saved-plans-v1')).toBe(savedData);
  });

  it('aborts a load before changing the route when fuel storage cannot be written', () => {
    const { store, shapes } = route();
    const saved = createPlan('Training', capturePlan(store, shapes));
    store.clear();
    store.addWaypoint({ lat: 60, lon: 10 }, 'Unsaved');
    const before = capturePlan(store, shapes);
    const repository = new SavedPlanRepository({ getItem: () => null, setItem: () => undefined });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
    expect(() => repository.load(saved, store, shapes)).toThrow('fuel settings');
    expect(capturePlan(store, shapes)).toEqual(before);
  });
});

describe('saved plan controls', () => {
  it('renders imported waypoint names as text in the OFP and weather controls', () => {
    const { store, shapes, a } = route();
    store.updateWaypoint(a.id, { name: '<img src=x onerror="alert(1)">' });
    const file = JSON.stringify(createPlan('Training', capturePlan(store, shapes)));
    const repository = new SavedPlanRepository(window.localStorage);
    repository.load(parsePlanFile(file), store, shapes);
    const ofpRoot = document.createElement('section');
    const weatherRoot = document.createElement('section');
    document.body.append(ofpRoot, weatherRoot);
    new OFPTable(ofpRoot, store).render();
    new WeatherPanel(weatherRoot, store).render();
    expect(ofpRoot.querySelector('img')).toBeNull();
    expect(weatherRoot.querySelector('img')).toBeNull();
    expect(ofpRoot.textContent).toContain('<img src=x onerror="alert(1)">');
    expect(weatherRoot.textContent).toContain('<img src=x onerror="alert(1)">');
  });

  it('discards a pending forecast when another plan is loaded', async () => {
    const { store } = route();
    let resolve!: (sample: Awaited<ReturnType<typeof fetchForecastSample>>) => void;
    vi.mocked(fetchForecastSample).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const root = document.createElement('section');
    document.body.append(root);
    const weather = new WeatherPanel(root, store);
    weather.render();
    root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click();
    expect(fetchForecastSample).toHaveBeenCalled();
    weather.onPlanLoaded();
    resolve({ validTimeUtc: '2026-10-05T10:00:00Z', altitudeFt: 4500, altitudeClamped: false, windFromDeg: 210, windSpeedKt: 15, temperatureC: 5, source: 'Test' });
    await new Promise((done) => setTimeout(done, 0));
    expect(store.getWeatherForecasts()).toEqual([]);
    expect(root.textContent).toContain('Fetch a fresh route forecast');
    expect(root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.disabled).toBe(false);
  });

  it('saves, updates, loads and restores from visible controls without replacing an input while typing', () => {
    const { store, shapes, a, b } = route();
    const root = document.createElement('section');
    document.body.append(root);
    const loaded = vi.fn();
    new PlanLibraryPanel(root, store, shapes, loaded);
    const name = root.querySelector<HTMLInputElement>('#plan-name')!;
    const action = (value: string) => root.querySelector<HTMLButtonElement>(`[data-plan-action="${value}"]`)!.click();
    name.value = '<Training & copy>';
    action('save');
    expect(root.querySelector('.saved-plans-message')!.textContent).toBe('<Training & copy> saved.');
    const select = root.querySelector('select')!;
    expect(Array.from(select.options).find((option) => option.value === select.value)?.textContent).toBe('<Training & copy>');
    expect(root.querySelector('Training')).toBeNull();
    store.setPlannedAltitudeFt(a.id, b.id, 5500);
    expect(root.querySelector('#plan-name')).toBe(name);
    expect(root.textContent).toContain('current work differs');
    action('load');
    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBe(4500);
    expect(loaded).toHaveBeenCalledOnce();
    action('previous');
    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBe(5500);
    action('update');
    expect(new SavedPlanRepository(window.localStorage).list()[0].flightPlan.plannedAltitudesFt[0][1]).toBe(5500);
    action('duplicate');
    expect(new SavedPlanRepository(window.localStorage).list()).toHaveLength(2);
  });
});
