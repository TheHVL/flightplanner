import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';

beforeEach(() => {
  vi.stubGlobal('crypto', { randomUUID: vi.fn(() => Math.random().toString(36).slice(2)) });
});

describe('FlightPlanStore', () => {
  it('keeps route order and supports reordering', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    store.addWaypoint({ lat: 70, lon: 20 }, 'C');

    store.moveWaypoint(b.id, 1);
    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['A', 'C', 'B']);

    store.moveWaypoint(a.id, -1);
    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['A', 'C', 'B']);
  });

  it('recalculates route legs after waypoint movement', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 0, lon: 0 }, 'A');
    store.addWaypoint({ lat: 0, lon: 1 }, 'B');
    const before = store.getLegs()[0].distanceNm;

    store.updateWaypoint(a.id, { lon: 0.5 });
    const after = store.getLegs()[0].distanceNm;

    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before / 2, 6);
  });

  it('stores planned altitude separately for each route leg', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    const c = store.addWaypoint({ lat: 70, lon: 20 }, 'C');

    store.setPlannedAltitudeFt(a.id, b.id, 3500);
    store.setPlannedAltitudeFt(b.id, c.id, 5500);

    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBe(3500);
    expect(store.getPlannedAltitudeFt(b.id, c.id)).toBe(5500);
  });

  it('removes obsolete leg altitude settings after route changes', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 69.5, lon: 19 }, 'B');
    const c = store.addWaypoint({ lat: 70, lon: 20 }, 'C');

    store.setPlannedAltitudeFt(a.id, b.id, 3500);
    store.setPlannedAltitudeFt(b.id, c.id, 5500);
    store.removeWaypoint(b.id);

    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBeNull();
    expect(store.getPlannedAltitudeFt(b.id, c.id)).toBeNull();
  });
});
