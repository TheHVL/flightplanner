import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { identifyTestAirport } from './helpers/airports';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import {
  restoreWorkingRoute,
  saveWorkingRoute,
} from '../src/flightplan/workingRoutePersistence';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  vi.stubGlobal('window', {
    localStorage,
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal('CustomEvent', class {
    constructor(public readonly type: string) {}
  });
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) });
});

describe('local working-route persistence', () => {
  it('restores route geometry and route-specific planning inputs after a reload', () => {
    const source = new FlightPlanStore();
    const sourceShapes = new RouteShapeController(source);
    const a = source.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = source.addWaypoint({ lat: 69.4, lon: 19 }, 'B');
    identifyTestAirport(source, b.id);
    const c = source.addWaypoint({ lat: 69.8, lon: 20 }, 'C');

    source.setPlannedAltitudeFt(a.id, b.id, 4500);
    source.setManualMsaFt(a.id, b.id, 3200);
    source.setManualLegWind(a.id, b.id, { windFromDeg: 240, windSpeedKt: 18 });
    source.setWaypointVerticalConstraint(b.id, {
      mode: 'circuits',
      elevationFt: 254,
      icaoCode: 'ENDU',
      circuitCount: 2,
      minutesPerCircuit: 6,
    });
    expect(sourceShapes.setLegShape(0, { lat: 69.3, lon: 18.35 })).toBe(true);
    // Shaping clears the old MSA because the checked corridor changed. Re-enter
    // it afterwards to verify that the saved working route retains it.
    source.setManualMsaFt(a.id, b.id, 3300);

    const shapedDistance = source.getLegs()[0].distanceNm;
    expect(saveWorkingRoute(source, sourceShapes)).toBe(true);

    const restored = new FlightPlanStore();
    const restoredShapes = new RouteShapeController(restored);
    expect(restoreWorkingRoute(restored, restoredShapes)).toBe(true);

    const waypoints = restored.getWaypoints();
    expect(waypoints.map((waypoint) => waypoint.name)).toEqual(['A', 'B', 'C']);
    expect(waypoints.map((waypoint) => waypoint.id)).toEqual([a.id, b.id, c.id]);
    expect(restored.getPlannedAltitudeFt(a.id, b.id)).toBe(4500);
    expect(restored.getManualMsaFt(a.id, b.id)).toBe(3300);
    expect(restored.getManualLegWind(a.id, b.id)).toEqual({ windFromDeg: 240, windSpeedKt: 18 });
    expect(restored.getWaypointVerticalConstraint(b.id)).toMatchObject({
      mode: 'circuits',
      elevationFt: 254,
      icaoCode: 'ENDU',
      circuitCount: 2,
      minutesPerCircuit: 6,
    });
    expect(restoredShapes.hasAnyShapes()).toBe(true);
    expect(restored.getLegs()[0].distanceNm).toBeCloseTo(shapedDistance, 8);
  });

  it('removes the autosaved working route after the route is cleared', () => {
    const store = new FlightPlanStore();
    const shapes = new RouteShapeController(store);
    store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    store.addWaypoint({ lat: 70, lon: 20 }, 'B');

    expect(saveWorkingRoute(store, shapes)).toBe(true);
    store.clear();
    expect(saveWorkingRoute(store, shapes)).toBe(true);

    const freshStore = new FlightPlanStore();
    const freshShapes = new RouteShapeController(freshStore);
    expect(restoreWorkingRoute(freshStore, freshShapes)).toBe(false);
    expect(freshStore.getWaypoints()).toEqual([]);
  });
});
