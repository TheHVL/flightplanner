import { aipFreshness, validateAipCatalog, type AipAerodromeCatalog, type AipRefreshStatus } from '../aip/aerodromes';
import type { Coordinate } from '../types';
import { northernAirports } from './northernAirports';

export interface VfrRoutingNode extends Coordinate { id: string; airport: boolean; name: string; }
export interface VfrRoutingEdge {
  fromId: string;
  toId: string;
  routeId: string;
  maxAltitudeFt: number | null;
  sourceUrl: string;
  chartSha256: string;
  effectiveDate: string;
  /** Point sequences do not encode chart bends, airport joins or clearances. */
  requiresChartReview: true;
}
export interface VfrRoutingInputs {
  usable: boolean;
  readyForAutomaticRouting: false;
  effectiveDate: string;
  checkedAt: string | null;
  nodes: VfrRoutingNode[];
  edges: VfrRoutingEdge[];
  coverageWarnings: string[];
}

/** Generator-only inputs. Withhold stale editions, changed charts and unresolved directions.
 * Never connect an airport or reverse a directed chart leg by inference.
 */
export function buildVfrRoutingInputs(catalog: AipAerodromeCatalog, status: AipRefreshStatus | null, flightDate: string, now = new Date()): VfrRoutingInputs {
  validateAipCatalog(catalog);
  const result: VfrRoutingInputs = { usable: false, readyForAutomaticRouting: false, effectiveDate: catalog.effectiveDate,
    checkedAt: catalog.checkedAt ?? null, nodes: [], edges: [], coverageWarnings: [...(catalog.coverageWarnings ?? [])] };
  const freshness = aipFreshness(catalog, status, now);
  const day = flightDate.slice(0, 10);
  if (freshness.warning || !status || status.effectiveDate !== catalog.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(day) || day < catalog.effectiveDate ||
      catalog.nextEffectiveDate && day >= catalog.nextEffectiveDate || !catalog.checkedAt || !Number.isFinite(Date.parse(catalog.checkedAt)) ||
      now.getTime() - Date.parse(catalog.checkedAt) > 48 * 3600000 || Date.parse(catalog.checkedAt) > now.getTime() + 300000) {
    result.coverageWarnings.push('Current AIP sources and the flight date must be verified before generating route candidates.');
    return result;
  }
  result.usable = true;
  const airports = northernAirports(catalog);
  const points = (catalog.reportingPoints ?? []).filter(p => airports.some(a => a.icao === p.aerodromeIcao));
  result.nodes = [...airports.flatMap(a => a.lat === null || a.lon === null ? [] : [{ id: a.icao, name: a.name, lat: a.lat, lon: a.lon, airport: true }]),
    ...points.map(p => ({ id: p.id, name: p.name, lat: p.lat, lon: p.lon, airport: false }))];
  const ids = new Set(result.nodes.map(n => n.id));
  for (const route of catalog.vfrRoutes ?? []) {
    if (!airports.some(a => a.icao === route.aerodromeIcao)) continue;
    const chart = airports.find(a => a.icao === route.aerodromeIcao)?.charts?.find(c => c.sourceUrl === route.sourceUrl && c.sha256 === route.chartSha256);
    if (!chart || !route.chartSha256 || !route.segments?.length) { result.coverageWarnings.push(`${route.id}: reviewed chart limits unavailable.`); continue; }
    for (const segment of route.segments) {
      if (!ids.has(segment.fromPointId) || !ids.has(segment.toPointId) || segment.direction === 'review') {
        result.coverageWarnings.push(`${route.id}: segment direction or chart altitude requires review.`); continue;
      }
      const add = (reverse: boolean) => result.edges.push({ fromId: reverse ? segment.toPointId : segment.fromPointId,
        toId: reverse ? segment.fromPointId : segment.toPointId, routeId: route.id,
        maxAltitudeFt: reverse && segment.reverseMaxAltitudeFt !== undefined ? segment.reverseMaxAltitudeFt : segment.maxAltitudeFt,
        sourceUrl: route.sourceUrl, chartSha256: route.chartSha256!, effectiveDate: catalog.effectiveDate, requiresChartReview: true });
      if (['both', 'forward'].includes(segment.direction)) add(false);
      if (['both', 'reverse'].includes(segment.direction)) add(true);
    }
  }
  result.coverageWarnings.push('Airport selection covers mainland AIP airports at or north of Trondheim (ENVA included). Verified terminal route coverage remains partial. Airport joins, pattern geometry, obstacles and complete restricted airspace are not encoded. Chart bends must be reviewed before automatic routing.');
  result.coverageWarnings = [...new Set(result.coverageWarnings)];
  return result;
}
