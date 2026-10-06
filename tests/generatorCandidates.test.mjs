import { describe, expect, it } from 'vitest';
import { generateRouteCandidates, validateGeneratorRequest } from '../src/generator/candidates';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { unprojectTerrainPoint } from '../src/routing/terrainRaster';
import { generatorFixture, generatorNow, generatorRequest, generatorRaster } from './helpers/generatorFixture.mjs';
describe('automatic planner draft candidates', async () => {
  it('preserves ordered airport visits, patterns, chart ceilings and AIP provenance', async () => {
    const { catalog, refresh } = generatorFixture();
    const candidates = await generateRouteCandidates(generatorRequest, catalog, refresh, generatorNow, { raster: generatorRaster() });
    expect(candidates.length).toBeGreaterThan(0); expect(candidates.length).toBeLessThanOrEqual(6);
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
  it('does not mutate an existing manual plan while searching or add unrequested activities', async () => {
    const manual = new FlightPlanStore(); manual.addWaypoint({ lat: 69, lon: 18 }, 'Manual route');
    const before = manual.exportWorkingDraftState();
    const { catalog, refresh } = generatorFixture();
    const request = { ...generatorRequest, visits: generatorRequest.visits.map(v => ({ ...v, activity: 'touch-and-go' })), lessonMinutes: 180 };
    const candidates = await generateRouteCandidates(request, catalog, refresh, generatorNow, { raster: generatorRaster() });
    expect(manual.exportWorkingDraftState()).toEqual(before);
    expect(candidates.every(c => c.patternMinutes === 0)).toBe(true);
    expect(candidates.every(c => c.draft.waypoints.filter(p => /^[A-Z]{4}$/.test(p.aipId)).length === 4)).toBe(true);
  });
  it('rejects unsupported airports, impossible itineraries and stale/future editions', async () => {
    const { catalog, refresh } = generatorFixture();
    expect(() => validateGeneratorRequest({ ...generatorRequest, altitudeFt: 3001 })).toThrow();
    expect(() => validateGeneratorRequest({ ...generatorRequest, destination: 'ENBO' }, catalog)).toThrow('coverage');
    expect(() => validateGeneratorRequest({ ...generatorRequest, visits: [] })).toThrow('visit');
    expect(() => validateGeneratorRequest({ ...generatorRequest, visits: [{ ...generatorRequest.visits[0], icao: 'ENDU' }] })).toThrow('consecutive');
    await expect(generateRouteCandidates(generatorRequest, { ...catalog, checkedAt: '2026-10-01T12:00:00Z' }, refresh, generatorNow)).rejects.toThrow('verified');
    await expect(generateRouteCandidates({ ...generatorRequest, flightDate: '2026-10-29' }, catalog, refresh, generatorNow)).rejects.toThrow('verified');
  });
  it('routes an airport pair without programmed procedures and keeps terrain turns unpublished', async () => {
    const { catalog, refresh } = generatorFixture();
    const raster = { west: 600000, north: 7740000, resolutionM: 200, width: 250, height: 250,
      elevationsM: new Float32Array(62500), fetchedAt: generatorNow.toISOString(), sourceUrl: 'https://wcs.geonorge.no/' };
    for (let row = 70; row < 180; row++) for (let col = 105; col < 145; col++) raster.elevationsM[row * 250 + col] = 1600;
    const from = unprojectTerrainPoint({ x: 610000, y: 7715000 }), to = unprojectTerrainPoint({ x: 640000, y: 7715000 });
    catalog.aerodromes = ['ENAA', 'ENBB'].map((icao, i) => ({ ...catalog.aerodromes[0], icao, name: icao, elevationFt: 20,
      ...(i ? to : from), charts: [] }));
    catalog.reportingPoints = []; catalog.vfrRoutes = [];
    const candidates = await generateRouteCandidates({ ...generatorRequest, departure: 'ENAA', destination: 'ENBB', visits: [] }, catalog, refresh, generatorNow, { raster });
    expect(candidates).toHaveLength(1);
    const candidate = candidates[0], turns = candidate.draft.waypoints.slice(1, -1);
    expect(turns.length).toBeGreaterThan(0);
    expect(turns.every(p => p.aipId === undefined && p.aipEffectiveDate === undefined)).toBe(true);
    expect(candidate.draft.waypoints.filter(p => p.aipId).map(p => p.aipId)).toEqual(['ENAA', 'ENBB']);
    expect(candidate.reviewedEdges).toEqual([]);
    expect(candidate.sourceNotes.join(' ')).toContain('verified directional terminal procedures are unavailable');
    const restored = new FlightPlanStore(); expect(restored.restoreWorkingDraftState(candidate.draft)).toBe(true);
    expect(restored.getWaypoints().slice(1, -1).every(p => !restored.isAirportWaypoint(p.id))).toBe(true);
  });
});
