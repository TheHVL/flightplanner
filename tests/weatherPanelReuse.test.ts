// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { WeatherPanel } from '../src/components/WeatherPanel';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { SavedPlanRepository, capturePlan } from '../src/flightplan/savedPlans';
import { fetchForecastBatch, sampleForecastSeries, type ForecastSeries } from '../src/weather/openMeteo';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../src/fuel/fuelPlanning';
vi.mock('../src/weather/openMeteo', () => ({ fetchForecastBatch: vi.fn(), sampleForecastSeries: vi.fn() }));
const sample = { validTimeUtc: '2026-10-06T11:00:00Z', altitudeFt: 5500, altitudeClamped: false, windFromDeg: 280, windSpeedKt: 23, temperatureC: 3, source: 'Test' };
const series: ForecastSeries = { hourly: { time: [] } };
const settle = () => new Promise((done) => setTimeout(done, 0));
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); vi.mocked(fetchForecastBatch).mockReset(); vi.mocked(sampleForecastSeries).mockReset().mockReturnValue(sample); });
function setup() {
  const store = new FlightPlanStore();
  const a = store.addWaypoint({ lat: 69, lon: 18 }, 'ENDU');
  const b = store.addWaypoint({ lat: 69.6, lon: 19 }, 'ENTC');
  store.setPlannedAltitudeFt(a.id, b.id, 4500);
  store.setManualLegWind(a.id, b.id, { windFromDeg: 210, windSpeedKt: 10 });
  store.updateWeatherSettings({ departureTimeUtc: '2026-10-05T10:00', useForecastWinds: true });
  const root = document.createElement('section'); document.body.append(root);
  const panel = new WeatherPanel(root, store); panel.render();
  return { store, root, panel, a, b };
}
it('refreshes a loaded plan for a new flight date and level, preserving manual backups and open menus', async () => {
  const { store, root, panel, a, b } = setup();
  const shapes = new RouteShapeController(store);
  const repository = new SavedPlanRepository(localStorage);
  const plan = repository.save('Training', capturePlan(store, shapes));
  store.setRouteWeatherForecasts([{ ...sample, fromId: a.id, toId: b.id }]);
  repository.load(plan, store, shapes); panel.onPlanLoaded();
  expect(store.getWeatherForecasts()).toEqual([]);
  root.querySelector<HTMLDetailsElement>('[data-menu-section="manual-winds"]')!.open = true;
  const date = root.querySelector<HTMLInputElement>('[data-weather-time]')!;
  date.value = '2026-10-06T11:00'; date.dispatchEvent(new Event('change', { bubbles: true }));
  store.setPlannedAltitudeFt(a.id, b.id, 5500);
  vi.mocked(fetchForecastBatch).mockResolvedValueOnce([series]);
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  const [locations] = vi.mocked(fetchForecastBatch).mock.calls[0];
  const { lat, lon } = locations[0];
  const [, altitude, time] = vi.mocked(sampleForecastSeries).mock.calls[0];
  expect(lat).toBeGreaterThan(69); expect(lon).toBeGreaterThan(18); expect(altitude).toBe(5500);
  expect(time.toISOString().slice(0, 13)).toBe('2026-10-06T11');
  expect(store.getWeatherForecasts()[0]).toMatchObject({ windFromDeg: 280, windSpeedKt: 23, altitudeFt: 5500 });
  expect(store.getManualLegWind(a.id, b.id)).toEqual({ windFromDeg: 210, windSpeedKt: 10 });
  expect(store.getWeatherSettings().useForecastWinds).toBe(true);
  expect(root.textContent).toContain('Forecast winds are active');
  expect(root.querySelector<HTMLDetailsElement>('[data-menu-section="manual-winds"]')!.open).toBe(true);
});
it('ignores an in-flight forecast request after the flight date changes', async () => {
  const { store, root } = setup();
  let resolve!: (value: ForecastSeries[]) => void;
  vi.mocked(fetchForecastBatch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click();
  const date = root.querySelector<HTMLInputElement>('[data-weather-time]')!;
  date.value = '2026-10-07T11:00'; date.dispatchEvent(new Event('change', { bubbles: true }));
  resolve([series]); await settle();
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.disabled).toBe(false);
});
it('rejects a forecast result when its planned level changed while fetching', async () => {
  const { store, root, a, b } = setup();
  let resolve!: (value: ForecastSeries[]) => void;
  vi.mocked(fetchForecastBatch).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click();
  store.setPlannedAltitudeFt(a.id, b.id, 6500);
  resolve([series]); await settle();
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(root.textContent).toContain('Route or forecast settings changed');
});
it('recalculates headings, groundspeed, time and fuel when a saved plan receives corrected winds', async () => {
  const { store, root, panel, a, b } = setup();
  store.updatePerformanceSettings({usePohPerformance:false});
  store.updateVerticalProfileSettings({departureElevationFt:4500,destinationElevationFt:4500});
  const fuel = {...DEFAULT_FUEL_PLANNING_SETTINGS,manualCruiseFuelFlowGph:12};
  const shapes = new RouteShapeController(store), repository = new SavedPlanRepository(localStorage);
  const saved = repository.save('Reuse',capturePlan(store,shapes));
  vi.mocked(fetchForecastBatch).mockResolvedValueOnce([series]);
  vi.mocked(sampleForecastSeries).mockReturnValueOnce({...sample,windFromDeg:210,windSpeedKt:5});
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  const before = calculateFuelPlanForStore(store,fuel).legs[0];
  repository.load(saved,store,shapes); panel.onPlanLoaded();
  const date = root.querySelector<HTMLInputElement>('[data-weather-time]')!;
  date.value = '2026-10-06T11:00'; date.dispatchEvent(new Event('change',{bubbles:true}));
  vi.mocked(fetchForecastBatch).mockResolvedValueOnce([series]);
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  const after = calculateFuelPlanForStore(store,fuel).legs[0];
  for (const key of ['trueHeadingDeg','groundSpeedKt','flightTimeMin','legFuelGal'] as const) {
    expect(after[key]).not.toBeNull(); expect(after[key]).not.toBeCloseTo(before[key]!,5);
  }
  expect(store.getManualLegWind(a.id,b.id)).toEqual({windFromDeg:210,windSpeedKt:10});
  expect(JSON.stringify(repository.list()[0])).toBe(JSON.stringify(saved));
});
it('invalidates forecasts atomically when the stored departure date changes, and supports undo', () => {
  const { store, a, b } = setup();
  store.setRouteWeatherForecasts([{...sample,fromId:a.id,toId:b.id}]);
  const seen: number[] = []; store.subscribe(()=>seen.push(store.getWeatherForecasts().length));
  store.updateWeatherSettings({departureTimeUtc:'2026-10-07T11:00'});
  expect(seen).toEqual([0]); expect(store.getManualLegWind(a.id,b.id)).not.toBeNull();
  store.undoLastAction();
  expect(store.getWeatherSettings().departureTimeUtc).toBe('2026-10-05T10:00');
  expect(store.getWeatherForecasts()).toHaveLength(1);
});
it('clears downstream forecasts and updates the weather message when a level changes', () => {
  const { store, root, a, b } = setup();
  const c = store.addWaypoint({lat:69.9,lon:20},'ENSR');
  store.setRouteWeatherForecasts([{...sample,fromId:a.id,toId:b.id},{...sample,fromId:b.id,toId:c.id}]);
  store.setPlannedAltitudeFt(a.id,b.id,5500);
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(root.querySelector('.weather-status')!.textContent).toContain('Fetch fresh winds');
  expect(store.getManualLegWind(a.id,b.id)).not.toBeNull();
});
it('uses the saved manual backup when refreshing winds fails, without retaining the previous forecast', async () => {
  const { store, root, a, b } = setup();
  store.setRouteWeatherForecasts([{...sample,fromId:a.id,toId:b.id}]);
  vi.mocked(fetchForecastBatch).mockRejectedValueOnce(new Error('Forecast temporarily unavailable'));
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(store.getLegWeatherForecast(a.id,b.id)).toMatchObject({windFromDeg:210,windSpeedKt:10,source:'Manual per-leg wind backup'});
  expect(root.textContent).toContain('Forecast temporarily unavailable');
  expect(root.textContent).toContain('Manual leg wind backups were kept');
  expect(root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.disabled).toBe(false);
});

it('fetches all leg coordinates once and samples later legs at wind-adjusted times', async () => {
  const { store, root } = setup();
  store.addWaypoint({ lat: 70, lon: 20 }, 'C');
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.updateNavigationSettings({ tasKt: 100 });
  const legs = store.getLegs();
  vi.mocked(fetchForecastBatch).mockResolvedValueOnce([series, series]);
  vi.mocked(sampleForecastSeries).mockReturnValueOnce({ ...sample, windFromDeg: legs[0].trueTrackDeg, windSpeedKt: 50 });
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  expect(fetchForecastBatch).toHaveBeenCalledTimes(1);
  expect(vi.mocked(fetchForecastBatch).mock.calls[0][0]).toHaveLength(2);
  expect(sampleForecastSeries).toHaveBeenCalledTimes(2);
  const secondTime = vi.mocked(sampleForecastSeries).mock.calls[1][2].getTime();
  const expected = Date.parse('2026-10-05T10:00:00Z') + (legs[0].distanceNm / 50 + legs[1].distanceNm / 200) * 3600000;
  expect(secondTime).toBeCloseTo(Math.floor(expected), 0);
  expect(store.getWeatherForecasts()).toHaveLength(2);
});

it('shows model selection, full valid date, retrieval age and a live refresh warning', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date('2026-10-06T11:00:00Z'));
    const { store, root, a, b } = setup();
    store.setRouteWeatherForecasts([{ ...sample, fromId: a.id, toId: b.id,
      fetchedAtUtc: '2026-10-06T11:00:00Z', modelSelection: 'best_match', modelName: null, modelRunTimeUtc: null }]);
    const status = () => root.querySelector<HTMLElement>('[data-weather-freshness]')!;
    expect(status().textContent).toContain('Open-Meteo Best Match');
    expect(status().textContent).toContain('(0 min ago)');
    expect(status().textContent).toContain('not model-run age');
    expect(root.querySelector('.weather-row')!.textContent).toContain('2026-10-06 11:00 UTC');
    expect(status().classList.contains('weather-freshness-warning')).toBe(false);
    vi.advanceTimersByTime(2 * 3600000);
    expect(status().classList.contains('weather-freshness-warning')).toBe(true);
    expect(status().textContent).toContain('Refresh route forecast');
    expect(store.getWeatherForecasts()).toHaveLength(1);
    store.setRouteWeatherForecasts([{ ...sample, fromId: a.id, toId: b.id, fetchedAtUtc: new Date().toISOString(), modelSelection: 'best_match' }]);
    expect(status().classList.contains('weather-freshness-warning')).toBe(false);
  } finally { vi.useRealTimers(); }
});

it('updates the forecast status when the user enables or disables the fetched winds', () => {
  const { store, root, a, b } = setup();
  store.updateWeatherSettings({ useForecastWinds: false });
  store.setRouteWeatherForecasts([{ ...sample, fromId:a.id, toId:b.id }]);
  const status = () => root.querySelector('.weather-status')!.textContent;
  expect(status()).toContain('Enable');
  root.querySelector<HTMLInputElement>('[data-weather-use]')!.click();
  expect(status()).toContain('Forecast winds are active');
  expect(status()).not.toContain('Enable');
  root.querySelector<HTMLInputElement>('[data-weather-use]')!.click();
  expect(status()).toContain('Enable');
  expect(status()).not.toContain('Forecast winds are active');
});

it('shows nearest-level forecast warnings with requested and sampled altitudes', () => {
  const {store,root,a,b} = setup();
  store.setRouteWeatherForecasts([{...sample, fromId:a.id,toId:b.id,altitudeFt:0,altitudeClamped:true,sampledAltitudeFt:328}]);
  expect(root.querySelector('.weather-altitude-warning')!.textContent).toContain('approximately 328 ft');
  expect(root.querySelector('.weather-altitude-warning')!.textContent).toContain('Requested 0 ft');
});
