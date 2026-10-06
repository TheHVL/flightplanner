import type { AipAerodrome, AipAerodromeCatalog, AipRefreshStatus } from '../aip/aerodromes';
import { FlightPlanStore, type FlightPlanWorkingDraftState } from '../flightplan/FlightPlanStore';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS } from '../fuel/fuelPlanning';
import { calculateRouteLegs, greatCircleDistanceNm } from '../navigation/geodesy';
import { buildVfrRoutingInputs, type VfrRoutingEdge } from '../routing/vfrInputs';
import type { Coordinate, RouteLeg } from '../types';

export interface AirportVisit { icao: string; activity: 'touch-and-go' | 'patterns' | 'land'; count: number; minutesEach: number; }
export interface GeneratorRequest {
  departure: string; destination: string; visits: AirportVisit[];
  flightDate: string; lessonMinutes: number; altitudeFt: number;
  rpm: number; manifoldPressureInHg: number; descentFuelFlowGph: number; patternFuelFlowGph: number;
}
export interface DraftPoint extends Coordinate { name: string; aipId: string; elevationFt?: number; }
export interface RouteCandidate {
  id: string; name: string; draft: FlightPlanWorkingDraftState; legs: RouteLeg[];
  distanceNm: number; flightMinutes: number; patternMinutes: number; totalMinutes: number;
  fuelGal: number | null; durationDifference: number; sourceNotes: string[]; profileIssues: string[];
  reviewedEdges: VfrRoutingEdge[];
}
export const GENERATOR_AIRPORTS = ['ENDU', 'ENSR', 'ENTC'];
const airportPoint = (a: AipAerodrome): DraftPoint => ({ name: a.icao, aipId: a.icao, lat: a.lat!, lon: a.lon!, elevationFt: a.elevationFt });
const distance = (points: Coordinate[]) => points.slice(1).reduce((sum, p, i) => sum + greatCircleDistanceNm(points[i], p), 0);

export function validateGeneratorRequest(request: GeneratorRequest): void {
  const airports = [request.departure, ...request.visits.map(v => v.icao), request.destination];
  if (airports.some(code => !GENERATOR_AIRPORTS.includes(code))) throw new Error('Choose ENDU, ENTC or ENSR. This is the initial coverage area.');
  if (!request.visits.length && request.departure === request.destination) throw new Error('Add an airport visit for a return flight.');
  if (request.visits.length > 4 || airports.some((code, i) => i > 0 && airports[i - 1] === code)) throw new Error('Use at most four visits and avoid consecutive visits to the same airport.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(request.flightDate) || !Number.isFinite(Date.parse(request.flightDate))) throw new Error('Choose a flight date.');
  const inRange = (value: number, min: number, max: number) => Number.isFinite(value) && value >= min && value <= max;
  if (!inRange(request.lessonMinutes, 20, 240) || !inRange(request.altitudeFt, 1000, 10000) || !Number.isInteger(request.altitudeFt) || request.altitudeFt % 100 !== 0) throw new Error('Use a 20–240 minute lesson and a preferred altitude of 1000–10000 ft in 100 ft steps.');
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
        greatCircleDistanceNm(airportPoint(airport), b) - greatCircleDistanceNm(b, airportPoint(other))).slice(0, 3);
    return nearest.length ? nearest.map(p => [p]) : [[]];
  }
  return options.sort((a, b) => distance(outbound ? [airportPoint(airport), ...a, airportPoint(other)] : [airportPoint(other), ...a, airportPoint(airport)]) -
    distance(outbound ? [airportPoint(airport), ...b, airportPoint(other)] : [airportPoint(other), ...b, airportPoint(airport)])).slice(0, 4);
}

/** Bounded beam search across ordered airport visits, ranked against lesson duration. No arbitrary time-filling loops. */
export function generateRouteCandidates(request: GeneratorRequest, catalog: AipAerodromeCatalog, refresh: AipRefreshStatus | null, now = new Date()): RouteCandidate[] {
  validateGeneratorRequest(request);
  const inputs = buildVfrRoutingInputs(catalog, refresh, request.flightDate, now);
  if (!inputs.usable) throw new Error('The current AIP edition could not be verified for this flight date. Reload published data before generating drafts.');
  const codes = [request.departure, ...request.visits.map(v => v.icao), request.destination];
  const airports = codes.map(code => catalog.aerodromes.find(a => a.icao === code && a.lat !== null && a.lon !== null));
  if (airports.some(a => !a)) throw new Error('An airport coordinate is unavailable. Check the current AIP.');
  let paths: DraftPoint[][] = [[airportPoint(airports[0]!)]], visitedDistance = 0;
  const totalDirect = airports.slice(1).reduce((sum, a, i) => sum + greatCircleDistanceNm(airportPoint(airports[i]!), airportPoint(a!)), 0);
  const patternTime = request.visits.reduce((sum, v) => sum + (v.activity === 'patterns' ? v.count * v.minutesEach : 0), 0);
  for (let i = 1; i < airports.length; i++) {
    const from = airports[i - 1]!, to = airports[i]!;
    const departures = terminalOptions(from, to, true, catalog, inputs.edges), arrivals = terminalOptions(to, from, false, catalog, inputs.edges);
    const hops = departures.flatMap(out => arrivals.map(inbound => [...out, ...inbound, airportPoint(to)]));
    visitedDistance += greatCircleDistanceNm(airportPoint(from), airportPoint(to));
    const fraction = visitedDistance / totalDirect;
    const targetDistance = Math.max(1, request.lessonMinutes - patternTime) * 120 / 60 * fraction;
    paths = paths.flatMap(path => hops.map(hop => [...path, ...hop])).sort((a, b) => Math.abs(distance(a) - targetDistance) - Math.abs(distance(b) - targetDistance)).slice(0, 72);
  }
  const unique = [...new Map(paths.map(path => [path.map(p => p.aipId).join('|'), path])).values()];
  const candidates = unique.map((path, i) => createCandidate(path, request, catalog, inputs.edges, `draft-${i}`));
  candidates.sort((a, b) => a.profileIssues.length - b.profileIssues.length || Math.abs(a.durationDifference) - Math.abs(b.durationDifference) || a.distanceNm - b.distanceNm);
  // Compare different terminal routes rather than three nearly identical point
  // substitutions. Keep the shortest remaining option as a duration comparison.
  const selected = candidates.slice(0, 1), first = selected[0];
  if (!first) return [];
  const firstPoints = new Set(first.draft.waypoints.map(p => p.aipId));
  const difference = (candidate: RouteCandidate) => candidate.draft.waypoints.filter(p => !firstPoints.has(p.aipId)).length;
  const alternatives = candidates.slice(1).filter(c => c.profileIssues.length === first.profileIssues.length && c.totalMinutes <= Math.max(request.lessonMinutes, first.totalMinutes) + 30);
  const alternative = alternatives.sort((a, b) => difference(b) - difference(a) || Math.abs(a.durationDifference) - Math.abs(b.durationDifference))[0] ?? candidates[1];
  if (alternative) selected.push(alternative);
  const shortest = [...candidates].sort((a, b) => a.profileIssues.length - b.profileIssues.length || a.distanceNm - b.distanceNm).find(c => !selected.includes(c));
  if (shortest) selected.push(shortest);
  return selected.map((c, i) => ({ ...c, name: i === 0 ? 'Closest to lesson duration' : i === 1 ? 'Alternative reporting points' : c.distanceNm < selected[0].distanceNm ? 'Shorter alternative' : 'Another route option' }));
}

function createCandidate(path: DraftPoint[], request: GeneratorRequest, catalog: AipAerodromeCatalog, edges: VfrRoutingEdge[], id: string): RouteCandidate {
  const store = new FlightPlanStore();
  store.appendAipWaypoints(path.map(p => ({ ...p, aipEffectiveDate: catalog.effectiveDate })));
  store.updateWeatherSettings({ useForecastWinds: false, departureTimeUtc: `${request.flightDate}T12:00` });
  store.updateNavigationSettings({ windFromDeg: 0, windSpeedKt: 0, automaticVariation: true });
  store.updatePerformanceSettings({ usePohPerformance: true, rpm: request.rpm, manifoldPressureInHg: request.manifoldPressureInHg,
    pressureAltitudeFt: request.altitudeFt, oatC: 15 - request.altitudeFt * 0.0019812 });
  const waypoints = store.getWaypoints(), legs = store.getLegs(), reviewedEdges: VfrRoutingEdge[] = [];
  const notes = new Set<string>(['Draft airport joins and connecting lines must be shaped against the published charts. ATC clearance, restricted airspace, obstacles and weather are not resolved.']);
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
  const descentFtPerNm = vertical.descentRateFpm * 60 / vertical.descentGroundSpeedKt;
  for (let end = 1; end < path.length; end++) {
    if (path[end].elevationFt === undefined) continue;
    let nextAltitude = path[end].elevationFt!;
    for (let index = end - 1; index >= 0; index--) {
      const leg = legs[index];
      const current = store.getPlannedAltitudeFt(leg.from.id, leg.to.id)!;
      const reachable = Math.floor((nextAltitude + leg.distanceNm * descentFtPerNm) / 100) * 100;
      const altitude = Math.min(current, Math.max(path[end].elevationFt!, reachable));
      store.setPlannedAltitudeFt(leg.from.id, leg.to.id, altitude);
      nextAltitude = altitude;
      if (path[index].elevationFt !== undefined) break;
    }
  }
  notes.add('Approach draft levels may be lower than the preferred altitude to allow the modeled 500 ft/min descent at 120 KTAS. Check them against chart procedures and terrain.');
  const fuel = calculateFuelPlanForStore(store, { ...DEFAULT_FUEL_PLANNING_SETTINGS, descentFuelFlowGph: request.descentFuelFlowGph, circuitFuelFlowGph: request.patternFuelFlowGph });
  const issues: string[] = [];
  if (!fuel.verticalProfile || fuel.verticalProfile.profilesOverlap || fuel.verticalProfile.climbPerformanceIncomplete) issues.push('Climb/descent profile needs correction.');
  if (fuel.legs.some(l => !!l.performanceError || !!l.phaseWarning) || fuel.legs.some(l => !Number.isFinite(l.flightTimeMin))) issues.push('Aircraft performance is incomplete for this draft.');
  const flightMinutes = fuel.legs.reduce((sum, l) => sum + l.flightTimeMin, 0), patternMinutes = store.getTotalWaypointActivityMinutes();
  return { id, name: '', draft: store.exportWorkingDraftState(), legs: calculateRouteLegs(waypoints), distanceNm: distance(path), flightMinutes, patternMinutes,
    totalMinutes: flightMinutes + patternMinutes, fuelGal: fuel.tripFuelGal, durationDifference: flightMinutes + patternMinutes - request.lessonMinutes,
    sourceNotes: [...notes], profileIssues: issues, reviewedEdges };
}
