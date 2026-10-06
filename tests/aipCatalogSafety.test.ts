import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { aipFreshness, validateAipCatalog, type AipAerodromeCatalog } from '../src/aip/aerodromes';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
// The deployed catalog is external JSON, not a compile-time literal. Refreshed
// segment directions are checked by the schema validator below.
const c: AipAerodromeCatalog = JSON.parse(readFileSync('public/aip-aerodromes.json', 'utf8'));
describe('AIP freshness and integration', () => {
  it('validates the complete bundled snapshot and every route reference', () => {
    expect(() => validateAipCatalog(c)).not.toThrow();
    expect(c.aerodromes.length).toBeGreaterThanOrEqual(20);
    expect(c.aerodromes.every(ad=>ad.runways!.length > 0 && ad.frequencies!.length > 0)).toBe(true);
  });
  it('reports failures, future editions and expired verification without declaring an old snapshot current', () => {
    const now = new Date('2026-10-05T12:00:00Z');
    expect(aipFreshness({...c,checkedAt:'2026-10-05T11:00:00Z'},null,now).warning).toBe(false);
    expect(aipFreshness(c,{state:'failed',attemptedAt:'2026-10-05T11:00:00Z',effectiveDate:null},now).warning).toBe(true);
    expect(aipFreshness({...c,effectiveDate:'2026-10-29'},null,now).warning).toBe(true);
    expect(aipFreshness({...c,checkedAt:'2026-10-01T11:00:00Z'},null,now).warning).toBe(true);
    expect(aipFreshness({...c,nextEffectiveDate:'2026-10-01'},null,now).warning).toBe(true);
  });
  it('adds a published sequence as one undoable action and persists provenance', () => {
    const store = new FlightPlanStore();
    store.addWaypoint({lat:69,lon:18},'Start');
    const points=c.reportingPoints!.slice(0,2).map(point=>({ ...point,aipId:point.id,aipEffectiveDate:c.effectiveDate }));
    store.appendAipWaypoints(points);
    const restored=new FlightPlanStore();
    expect(restored.restoreWorkingDraftState(store.exportWorkingDraftState())).toBe(true);
    expect(restored.getWaypoints()[1].aipId).toBe(points[0].id);
    expect(store.undoLastAction()).toBe(true);
    expect(store.getWaypoints().map(p=>p.name)).toEqual(['Start']);
  });
  it('feeds published elevations into departure, destination and intermediate airport constraints', () => {
    const store=new FlightPlanStore();
    store.appendAipWaypoints(c.aerodromes.slice(0,3).map(ad=>({name:ad.icao,lat:ad.lat!,lon:ad.lon!,aipId:ad.icao,aipEffectiveDate:c.effectiveDate,elevationFt:ad.elevationFt})));
    expect(store.getVerticalProfileSettings().departureElevationFt).toBe(c.aerodromes[0].elevationFt);
    expect(store.getVerticalProfileSettings().destinationElevationFt).toBe(c.aerodromes[2].elevationFt);
    const intermediate=store.getWaypoints()[1];
    expect(store.getWaypointVerticalConstraint(intermediate.id).elevationFt).toBe(c.aerodromes[1].elevationFt);
    store.updateWaypoint(intermediate.id,{lat:60});
    expect(store.getWaypoints()[1].aipId).toBeUndefined();
  });
});
