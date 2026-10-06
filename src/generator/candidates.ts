import type { AipAerodrome, AipAerodromeCatalog, AipRefreshStatus } from '../aip/aerodromes';
import { FlightPlanStore, type FlightPlanWorkingDraftState } from '../flightplan/FlightPlanStore';
import { calculateFuelPlanForStore } from '../fuel/fuelPlanning';
import { calculateRouteLegs, greatCircleDistanceNm } from '../navigation/geodesy';
import { buildVfrRoutingInputs, type VfrRoutingEdge } from '../routing/vfrInputs';
import type { Coordinate, RouteLeg } from '../types';
import { northernAirports } from '../routing/northernAirports';
import { fetchRouteTerrainRaster, projectTerrainPoint, rasterCorridorMaximumM, type TerrainRaster } from '../routing/terrainRaster';
import { TerrainRouter } from '../routing/terrainRouter';
import { applySchoolAircraftSettings } from '../performance/schoolPreset';
import { generatorFuelSettings } from './aircraft';
import { candidateAltitudeModel } from './model';
import { coordinateAtRouteDistance } from '../navigation/geodesy';
import type { RadioCatalog } from '../frequencies/catalog';
import { restrictionSegmentAllowed } from '../routing/restrictions';
import { profileRouteIssues, type RasterLegIssue, type RouteIssue } from '../routing/issues';

export interface AirportVisit { icao: string; activity: 'touch-and-go' | 'patterns' | 'land'; count: number; minutesEach: number; }
export interface GeneratorRequest {
  departure: string; destination: string; visits: AirportVisit[];
  flightDate: string; lessonMinutes: number; altitudeFt: number;
  rpm: number; manifoldPressureInHg: number; descentFuelFlowGph: number; patternFuelFlowGph: number;
  schoolPreset?: boolean; climbRateFpm?: number; descentRateFpm?: number; climbFuelFlowGph?: number | null;
}
export interface DraftPoint extends Coordinate { name: string; aipId: string; elevationFt?: number; }
export interface RouteCandidate {
  id: string; name: string; draft: FlightPlanWorkingDraftState; legs: RouteLeg[];
  distanceNm: number; flightMinutes: number; patternMinutes: number; totalMinutes: number;
  fuelGal: number | null; durationDifference: number; sourceNotes: string[]; profileIssues: string[];
  reviewedEdges: VfrRoutingEdge[];
  profileWarnings: RouteIssue[];
  coverageIssues: RouteIssue[];
  rasterIssues: RasterLegIssue[];
  searchTerrain: { resolutionM: number; fetchedAt: string; highestRasterFt: number | null; conflicts: number; missingCorridors: number };
}
export const INITIAL_GENERATOR_AIRPORTS = ['ENDU', 'ENSR', 'ENTC'];
const airportPoint = (a: AipAerodrome): DraftPoint => ({ name: a.icao, aipId: a.icao, lat: a.lat!, lon: a.lon!, elevationFt: a.elevationFt });
const distance = (points: Coordinate[]) => points.slice(1).reduce((sum, p, i) => sum + greatCircleDistanceNm(points[i], p), 0);

export function validateGeneratorRequest(request: GeneratorRequest, catalog?: AipAerodromeCatalog): void {
  const airports = [request.departure, ...request.visits.map(v => v.icao), request.destination];
  if (airports.some(code => !/^EN[A-Z]{2}$/.test(code) || catalog && !northernAirports(catalog).some(a => a.icao === code))) throw new Error('Choose a published mainland airport at or north of Bodø. This is the terrain search coverage area.');
  if (!request.visits.length && request.departure === request.destination) throw new Error('Add an airport visit for a return flight.');
  if (request.visits.length > 4 || airports.some((code, i) => i > 0 && airports[i - 1] === code)) throw new Error('Use at most four visits and avoid consecutive visits to the same airport.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.flightDate) || !Number.isFinite(Date.parse(request.flightDate))) throw new Error('Choose a flight date.');
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (!inRange(request.lessonMinutes, 20, 240) || !inRange(request.altitudeFt, 1000, 10000) || !Number.isInteger(request.altitudeFt) || request.altitudeFt % 100 !== 0) throw new Error('Use a 20–240 minute lesson and a preferred altitude of 1000–10000 ft in 100 ft steps.');
  if (request.schoolPreset && (!inRange(request.climbRateFpm ?? NaN, 100, 5000) || !inRange(request.descentRateFpm ?? NaN, 100, 5000) || (request.climbFuelFlowGph != null && !inRange(request.climbFuelFlowGph, 0.1, 40)))) throw new Error('Check the school climb/descent rates and climb fuel flow.');
  if (!inRange(request.rpm, 2000, 2400) || request.rpm % 100 !== 0 || !inRange(request.manifoldPressureInHg, 15, 27) || !inRange(request.descentFuelFlowGph, 0.1, 30) || !inRange(request.patternFuelFlowGph, 0.1, 30)) throw new Error('Check the aircraft planning assumptions.');
  if (request.visits.some(v => !['touch-and-go', 'patterns', 'land'].includes(v.activity) || !Number.isInteger(v.count) || !inRange(v.count, 1, 20) || !inRange(v.minutesEach, 1, 30))) throw new Error('Check the airport activities and pattern duration.');
}

/** Reporting-point sequences remain drafts: no airport join or chart bend is inferred as published geometry. */
function terminalOptions(airport: AipAerodrome, other: AipAerodrome, outbound: boolean, catalog: AipAerodromeCatalog, edges: VfrRoutingEdge[]): DraftPoint[][] {
  const points = new Map((catalog.reportingPoints ?? []).filter(p => !/\bhelicopters?\s+only\b/i.test(p.remarks ?? '')).map(p => [p.id, { ...p, aipId: p.id }]));
  const options: DraftPoint[][] = [];
  for (const route of catalog.vfrRoutes ?? []) {
    if (route.aerodromeIcao !== airport.icao) continue;
    if (!route.pointIds.every(id => points.has(id))) continue;
    for (const ids of [route.pointIds, [...route.pointIds].reverse()]) {
      if (!ids.slice(1).every((id, i) => edges.some(e => e.routeId === route.id && e.fromId === ids[i] && e.toId === id))) continue;
      const chain = ids.map(id => points.get(id)!);
      const first = greatCircleDistanceNm(airportPoint(airport), chain[0]), last = greatCircleDistanceNm(airportPoint(airport), chain.at(-1)!);
      if (outbound ? first > last : first < last) continue;
      options.push(chain);
    }
  }
  if (!options.length) {
    // A point's location is verified independently of its routes. A single
    // reporting point may anchor a draft connector; it is not a charted join.
    const nearest = [...points.values()].filter(p => p.aerodromeIcao === airport.icao)
      .sort((a, b) => greatCircleDistanceNm(airportPoint(airport), a) + greatCircleDistanceNm(a, airportPoint(other)) -
        greatCircleDistanceNm(airportPoint(airport), b) - greatCircleDistanceNm(b, airportPoint(other)));
    return nearest.length ? nearest.map(p => [p]) : [[]];
  }
  return options.sort((a, b) => distance(outbound ? [airportPoint(airport), ...a, airportPoint(other)] : [airportPoint(other), ...a, airportPoint(airport)]) -
    distance(outbound ? [airportPoint(airport), ...b, airportPoint(other)] : [airportPoint(other), ...b, airportPoint(airport)]));
}

export interface GenerationOptions {
  signal?: AbortSignal; raster?: TerrainRaster;
  airspace?: RadioCatalog | null;
  progress?: (message: string) => void;
}
/** Search all available terminal combinations through a generic terrain graph.
 * Final sampled/profile review happens before selecting the three UI alternatives.
 */
export async function generateRouteCandidates(request: GeneratorRequest, catalog: AipAerodromeCatalog, refresh: AipRefreshStatus | null,
  now = new Date(), options: GenerationOptions = {}): Promise<RouteCandidate[]> {
  validateGeneratorRequest(request, catalog);
  const signal = options.signal ?? new AbortController().signal; signal.throwIfAborted();
  const inputs = buildVfrRoutingInputs(catalog, refresh, request.flightDate, now);
  if (!inputs.usable) throw new Error('The current AIP edition could not be verified for this flight date. Reload published data before generating drafts.');
  const codes = [request.departure, ...request.visits.map(v => v.icao), request.destination];
  const airports = codes.map(code => catalog.aerodromes.find(a => a.icao === code && a.lat !== null && a.lon !== null)!);
  const pairs = airports.slice(1).map((to, i) => ({ from: airports[i], to,
    departures: terminalOptions(airports[i], to, true, catalog, inputs.edges),
    arrivals: terminalOptions(to, airports[i], false, catalog, inputs.edges) }));
  const raster = options.raster ?? await fetchRouteTerrainRaster([
    ...airports.map(airportPoint), ...pairs.flatMap(pair => [...pair.departures.flat(), ...pair.arrivals.flat()]),
  ], signal, (done, total) => options.progress?.(`Loading terrain search tiles: ${done}/${total}…`));
  options.progress?.(`Building terrain search (${raster.resolutionM} m raster)…`);
  await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
  const router = new TerrainRouter(raster);
  const segmentAllowed = restrictionSegmentAllowed(options.airspace ?? null, raster);
  let paths: DraftPoint[][] = [[airportPoint(airports[0])]];
  const connectorCache = new Map<string, Awaited<ReturnType<TerrainRouter['findPath']>>>();
  for (const [index, pair] of pairs.entries()) {
    const hops: DraftPoint[][] = []; let done = 0;
    for (const out of pair.departures) for (const inbound of pair.arrivals) {
      signal.throwIfAborted();
      options.progress?.(`Finding ${pair.from.icao} → ${pair.to.icao}: ${++done}/${pair.departures.length * pair.arrivals.length} entry/exit combinations…`);
      const start = out.at(-1) ?? airportPoint(pair.from), end = inbound[0] ?? airportPoint(pair.to);
      const departureCap = inputs.edges.find(e => e.fromId === out.at(-2)?.aipId && e.toId === start.aipId)?.maxAltitudeFt ?? undefined;
      const arrivalCap = inputs.edges.find(e => e.fromId === end.aipId && e.toId === inbound[1]?.aipId)?.maxAltitudeFt ?? undefined;
      const key = `${start.aipId}|${end.aipId}|${departureCap}|${arrivalCap}`;
      if (!connectorCache.has(key)) connectorCache.set(key, await router.findPath(start, end, request.altitudeFt, signal,
        { departureFt: departureCap, arrivalFt: arrivalCap }, segmentAllowed));
      const connector = connectorCache.get(key); if (!connector) continue;
      const turns: DraftPoint[] = connector.points.slice(1, -1).map((point, i) => ({ ...point,
        name: `Terrain turn ${i + 1}`, aipId: `terrain:${point.lat.toFixed(6)}:${point.lon.toFixed(6)}` }));
      hops.push([...out, ...turns, ...inbound, airportPoint(pair.to)]);
    }
    if (!hops.length) throw new Error(`No draft connection found for ${pair.from.icao} → ${pair.to.icao} at ${request.altitudeFt} ft within the terrain search and published restriction footprints. Try another itinerary or entry/exit. A higher preferred altitude cannot override terminal MAX limits or the conservative restriction avoidance. Missing terrain and the bounded search window can also prevent a result.`);
    // Feasibility and shorter coherent paths come before duration. Preserve
    // multiple terminal choices so the later profile review can reject a join.
    paths = paths.flatMap(path => hops.map(hop => [...path, ...hop])).sort((a, b) => distance(a) - distance(b)).slice(0, 48);
    options.progress?.(`Found terrain connections for airport section ${index + 1}/${pairs.length}…`);
  }
  const unique = [...new Map(paths.map(path => [path.map(p => p.aipId).join('|'), path])).values()];
  const candidates: RouteCandidate[] = [];
  for (const [i, path] of unique.entries()) {
    signal.throwIfAborted();
    const candidate = createCandidate(path, request, catalog, inputs.edges, `draft-${i}`, raster);
    checkRasterProfile(candidate, request, raster);
    candidates.push(candidate);
    if (i % 4 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  }
  candidates.sort(compareCandidates);
  // Fresh service checks on a diverse shortlist, then three displayed results.
  const selected: RouteCandidate[] = [];
  const signatures = new Set<string>();
  for (const candidate of candidates) {
    const signature = candidate.draft.waypoints.filter(p => p.aipId).map(p => p.aipId).join('|');
    if (signatures.has(signature)) continue;
    signatures.add(signature); selected.push(candidate);
    if (selected.length === 6) break;
  }
  return selected.map((candidate, i) => ({ ...candidate, name: `Terrain route draft ${i + 1}` }));
}
export function compareCandidates(a: RouteCandidate, b: RouteCandidate): number {
  return a.profileIssues.length - b.profileIssues.length || a.searchTerrain.conflicts - b.searchTerrain.conflicts ||
    a.searchTerrain.missingCorridors - b.searchTerrain.missingCorridors || Math.abs(a.durationDifference) - Math.abs(b.durationDifference) || a.distanceNm - b.distanceNm;
}
function checkRasterProfile(candidate: RouteCandidate, request: GeneratorRequest, raster: TerrainRaster): void {
  const model = candidateAltitudeModel(candidate, request), airports = candidate.draft.waypoints.filter(p => /^[A-Z]{4}$/.test(p.aipId ?? ''));
  for (const leg of candidate.legs) {
    const summary: RasterLegIssue = { legIndex: leg.index, startNm: 0, endNm: leg.distanceNm, highestFt: null, altitudeFt: null, conflicts: 0, missing: 0 };
    let minimumMargin = Infinity;
    const steps = Math.max(1, Math.ceil(leg.distanceNm / 0.5));
    for (let i = 0; i < steps; i++) {
      const fromDistance = leg.distanceNm * i / steps, toDistance = leg.distanceNm * (i + 1) / steps;
      const from = coordinateAtRouteDistance([leg], fromDistance)!, to = coordinateAtRouteDistance([leg], toDistance)!;
      // Retain the existing visible terminal-review treatment. This is not a
      // validated approach corridor and never supplies operational MSA.
      if (airports.some(a => greatCircleDistanceNm(a, from) <= 3 && greatCircleDistanceNm(a, to) <= 3)) continue;
      const maximum = rasterCorridorMaximumM(raster, projectTerrainPoint(from), projectTerrainPoint(to));
      const altitudes = [model.at(leg.index, fromDistance), model.at(leg.index, toDistance)];
      if (maximum === null || altitudes.some(a => a === null)) { candidate.searchTerrain.missingCorridors++; summary.missing++; continue; }
      const highestFt = maximum / 0.3048;
      candidate.searchTerrain.highestRasterFt = Math.max(candidate.searchTerrain.highestRasterFt ?? 0, highestFt);
      const altitude = Math.min(...altitudes as number[]), margin = altitude - highestFt;
      if (margin < 500) { candidate.searchTerrain.conflicts++; summary.conflicts++; }
      if (margin < minimumMargin) { minimumMargin = margin; summary.highestFt = highestFt; summary.altitudeFt = altitude; summary.startNm = fromDistance; summary.endNm = toDistance; }
    }
    if (summary.conflicts || summary.missing) candidate.rasterIssues.push(summary);
  }
}

function createCandidate(path: DraftPoint[], request: GeneratorRequest, catalog: AipAerodromeCatalog, edges: VfrRoutingEdge[], id: string, raster: TerrainRaster): RouteCandidate {
  const store = new FlightPlanStore();
  if (request.schoolPreset) {
    applySchoolAircraftSettings(store);
    store.updateVerticalProfileSettings({ climbRateFpm: request.climbRateFpm, descentRateFpm: request.descentRateFpm });
  }
  let turnNumber = 0;
  store.appendAipWaypoints(path.map(p => ({ ...p, name: p.aipId.startsWith('terrain:') ? `Terrain turn ${++turnNumber}` : p.name, aipEffectiveDate: catalog.effectiveDate })));
  // Geographic turns are editable custom waypoints, never published AIP points.
  for (const point of store.getWaypoints()) if (point.aipId?.startsWith('terrain:')) {
    store.updateWaypoint(point.id, { aipId: undefined, aipEffectiveDate: undefined });
  }
  store.updateWeatherSettings({ useForecastWinds: false, departureTimeUtc: `${request.flightDate}T12:00` });
  store.updateNavigationSettings({ windFromDeg: 0, windSpeedKt: 0, automaticVariation: true });
  store.updatePerformanceSettings({ usePohPerformance: true, rpm: request.rpm, manifoldPressureInHg: request.manifoldPressureInHg,
    pressureAltitudeFt: request.altitudeFt, oatC: 15 - request.altitudeFt * 0.0019812 });
  const waypoints = store.getWaypoints(), legs = store.getLegs(), reviewedEdges: VfrRoutingEdge[] = [];
  const notes = new Set<string>(['Inter-airport connectors were searched using Kartverket terrain data. Published terminal point sequences still need their actual chart bends and airport joins reviewed. ATC clearance, restriction activation, NOTAM, obstacles and weather are not resolved.', `Search raster: ${raster.resolutionM} m nearest-neighbour samples, fetched ${raster.fetchedAt}. Peaks between raster samples can be missed. This is not automatic MSA or verified terrain-safe routing.`, 'Terrain turns are custom geographic waypoints, not named landmarks or published VFR reporting points. Review water crossings and gliding distance to land.']);
  for (const point of path.filter(p => p.elevationFt !== undefined)) if (!edges.some(edge => edge.fromId.startsWith(`${point.aipId}:`))) notes.add(`${point.aipId}: verified directional terminal procedures are unavailable. Reporting-point anchors and airport joins require chart review.`);
  if (path.some(p => p.aipId === 'ENSR') && !edges.some(edge => edge.fromId.startsWith('ENSR:'))) notes.add('ENSR uses individual reporting-point anchors. Its charted segment directions and unqualified altitude labels remain unresolved; this draft does not apply those procedures.');
  for (const leg of legs) {
    const edge = edges.find(e => e.fromId === leg.from.aipId && e.toId === leg.to.aipId);
    let altitude = Math.min(request.altitudeFt, edge?.maxAltitudeFt ?? request.altitudeFt);
    if (edge) reviewedEdges.push(edge);
    // Carry the adjacent terminal ceiling to the draft airport-join level, but
    // never label that unverified connector as a published route constraint.
    if (path[leg.index].elevationFt !== undefined) {
      const next = edges.find(e => e.fromId === path[leg.index + 1]?.aipId && e.toId === path[leg.index + 2]?.aipId);
      altitude = Math.min(altitude, next?.maxAltitudeFt ?? altitude);
    }
    if (path[leg.index + 1].elevationFt !== undefined) {
      const previous = edges.find(e => e.fromId === path[leg.index - 1]?.aipId && e.toId === path[leg.index]?.aipId);
      altitude = Math.min(altitude, previous?.maxAltitudeFt ?? altitude);
    }
    store.setPlannedAltitudeFt(leg.from.id, leg.to.id, altitude);
    if (!edge) notes.add('Some connections have no verified VFR segment limits; their preferred levels are draft choices.');
  }
  let visitIndex = 0;
  for (let i = 1; i < waypoints.length - 1; i++) {
    if (path[i].elevationFt === undefined) continue;
    const visit = request.visits[visitIndex++];
    if (visit?.activity === 'patterns') store.setWaypointVerticalConstraint(waypoints[i].id, { mode: 'circuits', circuitCount: visit.count, minutesPerCircuit: visit.minutesEach });
  }
  // A ceiling is an upper limit, not a requirement to remain at that height
  // until the airport. Fit successive approach levels to the descent distance
  // available on each leg. Still-air assumptions match the shared profile model.
  const vertical = store.getVerticalProfileSettings();
  const cruiseSpeeds = vertical.legCruiseTasKt;
  for (let end = 1; end < path.length; end++) {
    if (path[end].elevationFt === undefined) continue;
    let nextAltitude = path[end].elevationFt!;
    for (let index = end - 1; index >= 0; index--) {
      const leg = legs[index];
      const current = store.getPlannedAltitudeFt(leg.from.id, leg.to.id)!;
      const descentTas = vertical.descentSpeedMode === 'cruise' ? cruiseSpeeds?.[index] : vertical.descentGroundSpeedKt;
      if (!descentTas || !Number.isFinite(descentTas)) continue;
      const descentFtPerNm = vertical.descentRateFpm * 60 / descentTas;
      const reachable = Math.floor((nextAltitude + leg.distanceNm * descentFtPerNm) / 100) * 100;
      const altitude = Math.min(current, Math.max(path[end].elevationFt!, reachable));
      store.setPlannedAltitudeFt(leg.from.id, leg.to.id, altitude);
      nextAltitude = altitude;
      if (path[index].elevationFt !== undefined) break;
    }
  }
  notes.add(`Approach draft levels may be lower than the preferred altitude to allow the modeled ${vertical.descentRateFpm} ft/min descent ${vertical.descentSpeedMode === 'cruise' ? 'at cruise TAS' : `at ${vertical.descentGroundSpeedKt} KTAS`}. Check them against chart procedures and terrain.`);
  const fuel = calculateFuelPlanForStore(store, generatorFuelSettings(request));
  const issues: string[] = [];
  const profileWarnings = fuel.verticalProfile ? profileRouteIssues(fuel.verticalProfile, legs) : [];
  if (!fuel.verticalProfile || fuel.verticalProfile.profilesOverlap || fuel.verticalProfile.climbPerformanceIncomplete) issues.push('Climb/descent profile needs correction.');
  if (fuel.legs.some(l => !!l.performanceError || !!l.phaseWarning) || fuel.legs.some(l => !Number.isFinite(l.flightTimeMin))) issues.push('Aircraft performance is incomplete for this draft.');
  fuel.legs.forEach((fuelLeg, index) => {
    if (fuelLeg.performanceError || fuelLeg.phaseWarning) profileWarnings.push({ id: `performance-${index}`, severity: 'incomplete', category: 'profile', blocksTransfer: true,
      legIndex: index, title: 'Aircraft performance unavailable', detail: fuelLeg.performanceError || fuelLeg.phaseWarning || '',
      action: 'Review the published aircraft performance at this altitude and cruise power. Correct the aircraft assumptions and generate again.', focus: 'profile' });
  });
  if (issues.length && !profileWarnings.length) profileWarnings.push({ id: 'profile-incomplete', severity: 'incomplete', category: 'profile', blocksTransfer: true,
    title: 'Climb/descent calculation incomplete', detail: issues.join(' '), action: 'Check the aircraft assumptions and available climb/descent distance, then generate again.', focus: 'profile' });
  const coverageIssues: RouteIssue[] = [];
  for (const [index, point] of path.entries()) if (point.elevationFt !== undefined) {
    const airport = catalog.aerodromes.find(a => a.icao === point.aipId)!;
    const missing = !edges.some(edge => edge.fromId.startsWith(`${point.aipId}:`));
    coverageIssues.push({ id: `procedure-${index}`, severity: 'review', category: 'coverage', blocksTransfer: false,
      legIndex: Math.min(index, legs.length - 1), title: `${point.aipId}: ${missing ? 'directional procedure coverage unavailable' : 'airport joins and chart tracks need review'}`,
      detail: missing ? 'This airport uses a reporting-point anchor or an unverified airport connection. It is not a published VFR procedure.' : 'Reporting-point directions and MAX limits are available, but chart bends, runway joins and pattern geometry are not encoded.',
      action: 'Open the airport’s published chart and procedures before using this draft. Review and shape the terminal track in Manual Planner.', sourceUrl: airport.sourceUrl });
  }
  const flightMinutes = fuel.legs.reduce((sum, l) => sum + l.flightTimeMin, 0), patternMinutes = store.getTotalWaypointActivityMinutes();
  return { id, name: '', draft: store.exportWorkingDraftState(), legs: calculateRouteLegs(waypoints), distanceNm: distance(path), flightMinutes, patternMinutes,
    totalMinutes: flightMinutes + patternMinutes, fuelGal: fuel.tripFuelGal, durationDifference: flightMinutes + patternMinutes - request.lessonMinutes,
    sourceNotes: [...notes], profileIssues: issues, reviewedEdges, profileWarnings, coverageIssues, rasterIssues: [],
    searchTerrain: { resolutionM: raster.resolutionM, fetchedAt: raster.fetchedAt, highestRasterFt: null, conflicts: 0, missingCorridors: 0 } };
}
