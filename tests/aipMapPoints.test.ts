// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { nearestPublishedPoint, publishedMapPoints } from '../src/aip/mapPoints';
import type { AipAerodromeCatalog } from '../src/aip/aerodromes';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { VerticalProfilePanel } from '../src/components/VerticalProfilePanel';
import { capturePlan, createPlan, parsePlanFile, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';

const catalog: AipAerodromeCatalog = JSON.parse(readFileSync('public/aip-aerodromes.json', 'utf8'));
const points = publishedMapPoints(catalog);
const airport = points.find(p => p.aipId === 'ENDU')!;
const reporting = points.find(p => p.aipId === 'ENDU:ROSSVOLL')!;
const arrival = points.find(p => p.aipId === 'ENTC')!;
beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });
const route = () => {
  const store = new FlightPlanStore(); store.setAipAerodromeCatalog(catalog);
  store.appendAipWaypoints([airport, reporting, arrival]);
  return store;
};

describe('AIP map points and snapping', () => {
  it('retains published coordinates and distinguishes an airport from its reporting points', () => {
    expect(airport).toMatchObject({ kind: 'airport', elevationFt: 254, aipId: 'ENDU' });
    expect(reporting).toMatchObject({ kind: 'reporting-point', name: 'ROSSVOLL', aerodromeIcao: 'ENDU' });
    expect(reporting.elevationFt).toBeUndefined();
    const store = route(), [a, r] = store.getWaypoints();
    expect(store.isAirportWaypoint(a.id)).toBe(true);
    expect(store.isAirportWaypoint(r.id)).toBe(false);
    expect(store.getWaypointVerticalConstraint(r.id).mode).toBe('auto');
  });
  it('snaps to the nearest point within both pixel and ground limits', () => {
    const project = (p: { lat: number; lon: number }) => ({ x: p.lon * 10000, y: p.lat * 10000 });
    expect(nearestPublishedPoint({ lat: reporting.lat + 0.001, lon: reporting.lon }, [reporting], project)).toBe(reporting);
    expect(nearestPublishedPoint({ lat: reporting.lat + 0.002, lon: reporting.lon }, [reporting], project)).toBeUndefined();
    expect(nearestPublishedPoint({ lat: reporting.lat + 1, lon: reporting.lon }, [reporting], () => ({ x: 0, y: 0 }))).toBeUndefined();
    const farther = { ...reporting, lat: reporting.lat + 0.001 };
    expect(nearestPublishedPoint(reporting, [farther, reporting], project)).toBe(reporting);
  });
  it('allows patterns at airports and rejects them at reporting points or a typed ICAO elsewhere', () => {
    const store = route(), [a, r] = store.getWaypoints();
    store.setWaypointVerticalConstraint(a.id, { mode: 'circuits', circuitCount: 2, minutesPerCircuit: 5 });
    store.setWaypointVerticalConstraint(r.id, { mode: 'circuits', icaoCode: 'ENDU' });
    const arbitrary = store.addWaypoint({ lat: 65, lon: 12 }, 'ENDU');
    store.setWaypointVerticalConstraint(arbitrary.id, { mode: 'circuits', icaoCode: 'ENDU' });
    expect(store.getWaypointActivityMinutes(a.id)).toBe(10);
    expect(store.getWaypointActivityMinutes(r.id)).toBe(0);
    expect(store.getWaypointActivityMinutes(arbitrary.id)).toBe(0);
    expect(store.getTotalWaypointActivityMinutes()).toBe(10);
  });
  it('moves a waypoint onto an airport in one undo action and clears its pattern when moved away', () => {
    const store = route(), r = store.getWaypoints()[1];
    store.updateWaypoint(r.id, { lat: airport.lat, lon: airport.lon }, airport);
    expect(store.isAirportWaypoint(r.id)).toBe(true);
    expect(store.getWaypointVerticalConstraint(r.id)).toMatchObject({ mode: 'airport', elevationFt: 254, icaoCode: 'ENDU' });
    store.undoLastAction();
    expect(store.getWaypoints()[1]).toMatchObject({ aipId: reporting.aipId, lat: reporting.lat, lon: reporting.lon });
    store.updateWaypoint(r.id, {}, airport);
    store.setWaypointVerticalConstraint(r.id, { mode: 'circuits', circuitCount: 2, minutesPerCircuit: 5 });
    store.updateWaypoint(r.id, { lat: 68, lon: 17 });
    expect(store.isAirportWaypoint(r.id)).toBe(false);
    expect(store.getWaypointActivityMinutes(r.id)).toBe(0);
    store.undoLastAction();
    expect(store.getWaypointActivityMinutes(r.id)).toBe(10);
    store.updateWaypoint(r.id, {}, reporting);
    expect(store.isAirportWaypoint(r.id)).toBe(false);
    expect(store.getWaypointActivityMinutes(r.id)).toBe(0);
  });
  it('preserves airport identity and patterns through schema-1 save/load', () => {
    const store = route(), a = store.getWaypoints()[2];
    store.setWaypointVerticalConstraint(a.id, { mode: 'circuits', circuitCount: 2, minutesPerCircuit: 5 });
    const plan = parsePlanFile(JSON.stringify(createPlan('AIP flight', capturePlan(store, new RouteShapeController(store)))));
    expect(plan.schemaVersion).toBe(1);
    const restored = new FlightPlanStore();
    new SavedPlanRepository(localStorage).load(plan, restored, new RouteShapeController(restored));
    expect(restored.isAirportWaypoint(a.id)).toBe(true);
    expect(restored.getWaypointActivityMinutes(a.id)).toBe(10);
    expect(restored.getWaypoints()[1].aipId).toBe(reporting.aipId);
  });
  it('recognizes legacy airport plans by ICAO and location without treating reporting points as airports', () => {
    const store = new FlightPlanStore();
    const a = store.addWaypoint({ lat: airport.lat, lon: airport.lon }, 'ENDU'), r = store.addWaypoint({ lat: reporting.lat, lon: reporting.lon }, 'ROSSVOLL');
    const draft = store.exportWorkingDraftState();
    draft.verticalWaypointConstraints = [a, r].map(p => [p.id, { mode: 'circuits', elevationFt: 254, icaoCode: 'ENDU', circuitCount: 2, minutesPerCircuit: 5 }]);
    store.restoreWorkingDraftState(draft);
    store.setAipAerodromeCatalog(catalog);
    expect(store.getWaypointActivityMinutes(a.id)).toBe(10);
    expect(store.getWaypointActivityMinutes(r.id)).toBe(0);
  });
  it('offers pattern controls only for the selected airport visit, including the final destination', () => {
    const store = route(), [a, r, dest] = store.getWaypoints();
    const element = document.createElement('section'); document.body.append(element);
    new VerticalProfilePanel(element, store, 'waypoint');
    const select = (id: string) => window.dispatchEvent(new CustomEvent('flightplanner-select-waypoint-visit', { detail: { waypointId: id } }));
    select(r.id);
    expect(element.querySelector('option[value="circuits"]')).toBeNull();
    select(dest.id);
    expect(element.querySelector('[aria-label="Arrival pattern"] option[value="circuits"]')).not.toBeNull();
    store.removeWaypoint(dest.id); select(r.id);
    expect(element.querySelector('[aria-label="Arrival pattern"]')).toBeNull();
    expect(store.isAirportWaypoint(a.id)).toBe(true);
  });
});
