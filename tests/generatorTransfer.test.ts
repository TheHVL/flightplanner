// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { capturePlan, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { stageGeneratedRoute, importGeneratedRoute } from '../src/generator/transfer';
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });
function draft() {
  const store = new FlightPlanStore(); store.appendAipWaypoints([
    { name: 'ENDU', lat: 69.05, lon: 18.5, elevationFt: 254, aipId: 'ENDU', aipEffectiveDate: '2026-09-03' },
    { name: 'ENTC', lat: 69.68, lon: 18.9, elevationFt: 32, aipId: 'ENTC', aipEffectiveDate: '2026-09-03' },
  ]);
  const leg = store.getLegs()[0]; store.setPlannedAltitudeFt(leg.from.id, leg.to.id, 3000);
  return store.exportWorkingDraftState();
}
describe('explicit generator transfer', () => {
  it('leaves manual work and saved plans untouched until explicit token navigation, then supports recovery', () => {
    const manual = new FlightPlanStore(), shapes = new RouteShapeController(manual);
    manual.addWaypoint({ lat: 69, lon: 18 }, 'My manual waypoint');
    const repository = new SavedPlanRepository(localStorage); repository.save('Named plan', capturePlan(manual, shapes));
    const before = manual.exportWorkingDraftState(), saved = repository.list();
    const token = stageGeneratedRoute(draft(), sessionStorage, 1000);
    expect(manual.exportWorkingDraftState()).toEqual(before);
    expect(importGeneratedRoute(null, sessionStorage, localStorage, manual, shapes, 1001)).toBe(false);
    expect(manual.exportWorkingDraftState()).toEqual(before);
    expect(importGeneratedRoute(token, sessionStorage, localStorage, manual, shapes, 1001)).toBe(true);
    expect(manual.getWaypoints().map(p => p.aipId)).toEqual(['ENDU','ENTC']);
    expect(repository.list()).toEqual(saved);
    expect(repository.hasPrevious()).toBe(true);
    expect(() => importGeneratedRoute(token, sessionStorage, localStorage, manual, shapes, 1002)).toThrow('no longer');
    repository.restorePrevious(manual, shapes); expect(manual.exportWorkingDraftState()).toEqual(before);
  });
  it('keeps manual work on malformed, mismatched, expired or failed-storage transfers', () => {
    const manual = new FlightPlanStore(), shapes = new RouteShapeController(manual); manual.addWaypoint({ lat: 69, lon: 18 });
    const before = manual.exportWorkingDraftState();
    const token = stageGeneratedRoute(draft(), sessionStorage, 1000);
    expect(() => importGeneratedRoute('other-token', sessionStorage, localStorage, manual, shapes, 1001)).toThrow('invalid');
    expect(() => importGeneratedRoute(token, sessionStorage, localStorage, manual, shapes, 2000000)).toThrow('expired');
    const unavailable = { getItem: () => null, setItem: () => { throw new Error('full'); } };
    expect(() => importGeneratedRoute(token, sessionStorage, unavailable, manual, shapes, 1001)).toThrow('recovery');
    expect(manual.exportWorkingDraftState()).toEqual(before);
    sessionStorage.setItem('flightplanner-generator-transfer-v1', '{broken');
    expect(() => importGeneratedRoute(token, sessionStorage, localStorage, manual, shapes, 1001)).toThrow('could not be read');
    sessionStorage.setItem('flightplanner-generator-transfer-v1', 'null');
    expect(() => importGeneratedRoute(token, sessionStorage, localStorage, manual, shapes, 1001)).toThrow('invalid');
    expect(manual.exportWorkingDraftState()).toEqual(before);
  });
});
