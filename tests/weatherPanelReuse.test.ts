// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { WeatherPanel } from '../src/components/WeatherPanel';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { SavedPlanRepository, capturePlan } from '../src/flightplan/savedPlans';
import { fetchForecastSample } from '../src/weather/openMeteo';
vi.mock('../src/weather/openMeteo', () => ({ fetchForecastSample: vi.fn() }));
const sample = { validTimeUtc: '2026-10-06T11:00:00Z', altitudeFt: 5500, altitudeClamped: false, windFromDeg: 280, windSpeedKt: 23, temperatureC: 3, source: 'Test' };
const settle = () => new Promise((done) => setTimeout(done, 0));
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear(); vi.mocked(fetchForecastSample).mockReset(); });
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
  vi.mocked(fetchForecastSample).mockResolvedValueOnce(sample);
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click(); await settle();
  const [lat, lon, altitude, time] = vi.mocked(fetchForecastSample).mock.calls[0];
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
  let resolve!: (value: typeof sample) => void;
  vi.mocked(fetchForecastSample).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click();
  const date = root.querySelector<HTMLInputElement>('[data-weather-time]')!;
  date.value = '2026-10-07T11:00'; date.dispatchEvent(new Event('change', { bubbles: true }));
  resolve(sample); await settle();
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.disabled).toBe(false);
});
it('rejects a forecast result when its planned level changed while fetching', async () => {
  const { store, root, a, b } = setup();
  let resolve!: (value: typeof sample) => void;
  vi.mocked(fetchForecastSample).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  root.querySelector<HTMLButtonElement>('[data-weather-fetch]')!.click();
  store.setPlannedAltitudeFt(a.id, b.id, 6500);
  resolve(sample); await settle();
  expect(store.getWeatherForecasts()).toEqual([]);
  expect(root.textContent).toContain('Route or forecast settings changed');
});
