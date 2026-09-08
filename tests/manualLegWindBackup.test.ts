import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { calculateFuelPlanForStore } from '../src/fuel/fuelPlanning';

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) });
});

describe('manual per-leg wind backup', () => {
  it('stores a manual wind without pretending it is a fetched forecast', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');

    store.setManualLegWind(a.id, b.id, { windFromDeg: 225, windSpeedKt: 18 });

    expect(store.getManualLegWind(a.id, b.id)).toEqual({ windFromDeg: 225, windSpeedKt: 18 });
    expect(store.getWeatherForecasts()).toEqual([]);
    expect(store.getLegWeatherForecast(a.id, b.id)).toMatchObject({
      windFromDeg: 225,
      windSpeedKt: 18,
      source: 'Manual per-leg wind backup',
    });
  });

  it('uses the manual leg wind in the vertical profile when per-leg route winds are enabled', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    store.updateNavigationSettings({ windFromDeg: 180, windSpeedKt: 5 });
    store.setManualLegWind(a.id, b.id, { windFromDeg: 260, windSpeedKt: 22 });
    store.updateWeatherSettings({ useForecastWinds: true });

    expect(store.getVerticalProfileSettings().legWinds).toEqual([
      { windFromDeg: 260, windSpeedKt: 22 },
    ]);
  });

  it('feeds the manual leg backup into the OFP/fuel navigation calculation', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.1, lon: 18.5 }, 'B');
    store.setPlannedAltitudeFt(a.id, b.id, 2500);
    store.setManualLegWind(a.id, b.id, { windFromDeg: 245, windSpeedKt: 17 });
    store.updateWeatherSettings({ useForecastWinds: true });

    const plan = calculateFuelPlanForStore(store);

    expect(plan.legs[0].forecastWindActive).toBe(true);
    expect(plan.legs[0].windFromDeg).toBe(245);
    expect(plan.legs[0].windSpeedKt).toBe(17);
  });

  it('gives a fetched forecast priority over the manual backup for the same leg', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    store.setManualLegWind(a.id, b.id, { windFromDeg: 260, windSpeedKt: 22 });
    store.setRouteWeatherForecasts([{
      fromId: a.id,
      toId: b.id,
      altitudeFt: 4500,
      validTimeUtc: '2026-09-08T12:00:00Z',
      windFromDeg: 210,
      windSpeedKt: 14,
      temperatureC: 3,
      source: 'Open-Meteo',
    }]);
    store.updateWeatherSettings({ useForecastWinds: true });

    expect(store.getLegWeatherForecast(a.id, b.id)).toMatchObject({
      windFromDeg: 210,
      windSpeedKt: 14,
      source: 'Open-Meteo',
    });
    expect(store.getVerticalProfileSettings().legWinds).toEqual([
      { windFromDeg: 210, windSpeedKt: 14 },
    ]);
  });

  it('restores manual leg wind changes with planner undo', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    store.setManualLegWind(a.id, b.id, { windFromDeg: 200, windSpeedKt: 10 });
    store.setManualLegWind(a.id, b.id, { windFromDeg: 240, windSpeedKt: 20 });

    expect(store.getManualLegWind(a.id, b.id)).toEqual({ windFromDeg: 240, windSpeedKt: 20 });
    expect(store.undoLastAction()).toBe(true);
    expect(store.getManualLegWind(a.id, b.id)).toEqual({ windFromDeg: 200, windSpeedKt: 10 });
  });

  it('clears an affected manual wind if waypoint geometry changes', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    store.setManualLegWind(a.id, b.id, { windFromDeg: 200, windSpeedKt: 10 });

    store.updateWaypoint(b.id, { lat: 69.6 });

    expect(store.getManualLegWind(a.id, b.id)).toBeNull();
  });
});
