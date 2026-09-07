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

  it('renumbers automatically named waypoints after a deletion so map and OFP stay aligned', () => {
    const store = new FlightPlanStore();
    const waypoints = Array.from({ length: 7 }, (_, index) =>
      store.addWaypoint({ lat: 69 + index * 0.1, lon: 18 + index * 0.1 }),
    );
    const originalWp06Id = waypoints[5].id;

    store.removeWaypoint(waypoints[4].id);

    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual([
      'WP01', 'WP02', 'WP03', 'WP04', 'WP05', 'WP06',
    ]);
    expect(store.getWaypoints().find((waypoint) => waypoint.id === originalWp06Id)?.name).toBe('WP05');
    expect(store.getLegs().map((leg) => leg.to.name)).toContain('WP05');
  });

  it('does not overwrite manually named waypoints when automatic waypoints are renumbered', () => {
    const store = new FlightPlanStore();
    const first = store.addWaypoint({ lat: 69, lon: 18 });
    store.addWaypoint({ lat: 69.1, lon: 18.1 }, 'ENDU');
    store.addWaypoint({ lat: 69.2, lon: 18.2 });

    store.removeWaypoint(first.id);

    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['ENDU', 'WP02']);
  });

  it('calculates circuit allowance time at an intermediate waypoint', () => {
    const store = new FlightPlanStore();
    store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const airport = store.addWaypoint({ lat: 69.5, lon: 19 }, 'ENDU');
    store.addWaypoint({ lat: 70, lon: 20 }, 'C');

    store.setWaypointVerticalConstraint(airport.id, {
      mode: 'circuits',
      elevationFt: 254,
      icaoCode: 'endu',
      circuitCount: 3,
      minutesPerCircuit: 5.5,
    });

    expect(store.getWaypointActivityMinutes(airport.id)).toBe(16.5);
    expect(store.getTotalWaypointActivityMinutes()).toBe(16.5);
    expect(store.getWaypointVerticalConstraint(airport.id).icaoCode).toBe('ENDU');
  });

  it('inserts a waypoint between two points and carries the old PL onto both split legs', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
    const b = store.addWaypoint({ lat: 70, lon: 20 }, 'B');
    store.setPlannedAltitudeFt(a.id, b.id, 4500);

    const inserted = store.insertWaypointAt(1, { lat: 69.5, lon: 19 });

    expect(inserted).not.toBeNull();
    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['A', 'WP02', 'B']);
    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBeNull();
    expect(store.getPlannedAltitudeFt(a.id, inserted!.id)).toBe(4500);
    expect(store.getPlannedAltitudeFt(inserted!.id, b.id)).toBe(4500);
  });

  it('undoes a route edit and restores waypoint names and leg planning state', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: 69, lon: 18 });
    const b = store.addWaypoint({ lat: 69.5, lon: 19 });
    const c = store.addWaypoint({ lat: 70, lon: 20 });
    store.setPlannedAltitudeFt(a.id, b.id, 3500);
    store.setPlannedAltitudeFt(b.id, c.id, 5500);

    store.removeWaypoint(b.id);
    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['WP01', 'WP02']);

    expect(store.undoLastAction()).toBe(true);
    expect(store.getWaypoints().map((waypoint) => waypoint.name)).toEqual(['WP01', 'WP02', 'WP03']);
    expect(store.getPlannedAltitudeFt(a.id, b.id)).toBe(3500);
    expect(store.getPlannedAltitudeFt(b.id, c.id)).toBe(5500);
  });

  it('undoes planning-setting changes as the most recent planner action', () => {
    const store = new FlightPlanStore();
    expect(store.getNavigationSettings().tasKt).toBe(130);

    store.updateNavigationSettings({ tasKt: 145 });
    expect(store.getNavigationSettings().tasKt).toBe(145);
    expect(store.canUndo()).toBe(true);

    store.undoLastAction();
    expect(store.getNavigationSettings().tasKt).toBe(130);
  });
});
