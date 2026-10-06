import { describe, expect, it } from 'vitest';
import { generateRouteCandidates, validateGeneratorRequest } from '../src/generator/candidates';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { generatorFixture, generatorNow, generatorRequest } from './helpers/generatorFixture.mjs';
describe('automatic planner draft candidates', () => {
  it('preserves ordered airport visits, patterns, chart ceilings and AIP provenance', () => {
    const { catalog, refresh } = generatorFixture();
    const candidates = generateRouteCandidates(generatorRequest, catalog, refresh, generatorNow);
    expect(candidates.length).toBeGreaterThan(0); expect(candidates.length).toBeLessThanOrEqual(3);
    for (const candidate of candidates) {
      const draft = candidate.draft;
      expect(draft.waypoints.filter(p => /^[A-Z]{4}$/.test(p.aipId)).map(p => p.aipId)).toEqual(['ENDU','ENTC','ENSR','ENDU']);
      expect(candidate.patternMinutes).toBe(10);
      expect(candidate.totalMinutes).toBeCloseTo(candidate.flightMinutes + 10);
      expect(candidate.fuelGal).toBeGreaterThan(0);
      expect(draft.manualMsaFt).toEqual([]); expect(draft.manualFrequencies).toEqual([]); expect(draft.manualLegWinds).toEqual([]);
      expect(draft.waypoints.every(p => p.aipEffectiveDate === catalog.effectiveDate)).toBe(true);
      for (const edge of candidate.reviewedEdges) {
        const from = draft.waypoints.find(p => p.aipId === edge.fromId && draft.waypoints.some((q,i) => q.id === p.id && draft.waypoints[i+1]?.aipId === edge.toId));
        if (!from) continue;
        const index = draft.waypoints.findIndex(p => p.id === from.id), to = draft.waypoints[index + 1];
        expect(draft.plannedAltitudesFt.find(([key]) => key === `${from.id}->${to.id}`)[1]).toBeLessThanOrEqual(edge.maxAltitudeFt ?? generatorRequest.altitudeFt);
      }
    }
    expect(new Set(candidates.map(c => c.draft.waypoints.map(p => p.aipId).join('|'))).size).toBe(candidates.length);
  });
  it('does not mutate an existing manual plan while searching or add unrequested activities', () => {
    const manual = new FlightPlanStore(); manual.addWaypoint({ lat: 69, lon: 18 }, 'Manual route');
    const before = manual.exportWorkingDraftState();
    const { catalog, refresh } = generatorFixture();
    const request = { ...generatorRequest, visits: generatorRequest.visits.map(v => ({ ...v, activity: 'touch-and-go' })), lessonMinutes: 180 };
    const candidates = generateRouteCandidates(request, catalog, refresh, generatorNow);
    expect(manual.exportWorkingDraftState()).toEqual(before);
    expect(candidates.every(c => c.patternMinutes === 0)).toBe(true);
    expect(candidates.every(c => c.draft.waypoints.filter(p => /^[A-Z]{4}$/.test(p.aipId)).length === 4)).toBe(true);
  });
  it('rejects unsupported airports, impossible itineraries and stale/future editions', () => {
    const { catalog, refresh } = generatorFixture();
    expect(() => validateGeneratorRequest({ ...generatorRequest, altitudeFt: 3001 })).toThrow();
    expect(() => validateGeneratorRequest({ ...generatorRequest, destination: 'ENBO' })).toThrow('coverage');
    expect(() => validateGeneratorRequest({ ...generatorRequest, visits: [] })).toThrow('visit');
    expect(() => validateGeneratorRequest({ ...generatorRequest, visits: [{ ...generatorRequest.visits[0], icao: 'ENDU' }] })).toThrow('consecutive');
    expect(() => generateRouteCandidates(generatorRequest, { ...catalog, checkedAt: '2026-10-01T12:00:00Z' }, refresh, generatorNow)).toThrow('verified');
    expect(() => generateRouteCandidates({ ...generatorRequest, flightDate: '2026-10-29' }, catalog, refresh, generatorNow)).toThrow('verified');
  });
});
