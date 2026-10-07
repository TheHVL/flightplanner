import type { RouteLeg } from '../types';
import { coordinateAtRouteDistance, greatCircleDistanceNm, routeLegPath } from '../navigation/geodesy';
import type { RadioArea, RadioCatalog, RadioVolume } from './catalog';
export interface ChannelSuggestion { channel: string; callSign: string; area: RadioArea; role: 'inside' | 'overlying' | 'sector'; remarks: string; }
export interface FrequencySegment { startNm: number; endNm: number; primary: ChannelSuggestion[]; alternatives: ChannelSuggestion[]; note?: string; }
const EPS = 1e-8;
const bounds = new WeakMap<RadioVolume, [number, number, number, number]>();
function bbox(v: RadioVolume): [number, number, number, number] {
  let b = bounds.get(v);
  if (!b) { b = [Infinity, Infinity, -Infinity, -Infinity]; for (const p of v.polygon) { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); } bounds.set(v, b); }
  return b;
}
export function pointInRadioPolygon(lon: number, lat: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const cross = (lon - a[0]) * (b[1] - a[1]) - (lat - a[1]) * (b[0] - a[0]);
    if (Math.abs(cross) < EPS && Math.hypot(b[0] - a[0], b[1] - a[1]) > EPS &&
        lon >= Math.min(a[0], b[0]) - EPS && lon <= Math.max(a[0], b[0]) + EPS && lat >= Math.min(a[1], b[1]) - EPS && lat <= Math.max(a[1], b[1]) + EPS) return true;
    if ((a[1] > lat) !== (b[1] > lat) && lon < (b[0] - a[0]) * (lat - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function contains(v: RadioVolume, lon: number, lat: number): boolean { const b = bbox(v); return lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && pointInRadioPolygon(lon, lat, v.polygon); }
function floor(v: RadioVolume): number { return v.lower.value ?? 0; }
function ceiling(v: RadioVolume): number { return v.upper.reference === 'UNL' ? Infinity : v.upper.value ?? Infinity; }
function selectAt(data: RadioCatalog, lon: number, lat: number, altitude: number | null): Omit<FrequencySegment, 'startNm' | 'endNm'> {
  if (altitude === null) return { primary: [], alternatives: [], note: 'Enter PL for this leg to match radio services by altitude.' };
  const selected: Array<{ area: RadioArea; role: ChannelSuggestion['role']; rank: number }> = [];
  let pressureBoundary = false;
  for (const area of data.airspaces) {
    let role: ChannelSuggestion['role'] | undefined;
    for (const v of area.volumes) {
      if (!contains(v, lon, lat) || v.lower.reference === 'AGL' || v.upper.reference === 'AGL') continue;
      const low = floor(v), high = ceiling(v);
      if ((v.lower.reference === 'FL' && Math.abs(altitude - low) < 300) || (v.upper.reference === 'FL' && Math.abs(altitude - high) < 300)) pressureBoundary = true;
      if (altitude >= low && altitude < high) role = area.type === 'sector' ? 'sector' : 'inside';
      else if (!role && altitude < low && ['TMA', 'CTA', 'TIA'].includes(area.type)) role = 'overlying';
    }
    if (role) {
      const rank = role === 'sector' ? 0 : role === 'overlying' ? 1 : ['CTR', 'TIZ', 'ATZ'].includes(area.type) ? 4 : ['TMA', 'TIA'].includes(area.type) ? 3 : 2;
      selected.push({ area, role, rank });
    }
  }
  const rank = Math.max(-1, ...selected.map(s => s.rank));
  const suggestions = (choices: typeof selected): ChannelSuggestion[] => {
    const items: ChannelSuggestion[] = [];
    for (const { area, role } of choices) {
      // Use a VFR-specific channel only when the publication explicitly labels it.
      let channels = area.channels;
      const vfr = channels.filter(c => /\bVFR\b/i.test(c.remarks ?? ''));
      if (vfr.length) channels = vfr;
      else if (channels.some(c => /Approach/i.test(c.callSign ?? area.callSign))) channels = channels.filter(c => !/Director/i.test(c.callSign ?? area.callSign));
      for (const c of channels) if (!items.some(i => i.channel === c.channel && i.callSign === (c.callSign || area.callSign))) items.push({ channel: c.channel, callSign: c.callSign || area.callSign, area, role, remarks: c.remarks || area.remarks });
    }
    return items;
  };
  const primary = suggestions(selected.filter(s => s.rank === rank));
  const alternatives = suggestions(selected.filter(s => s.rank < rank)).filter(c => !primary.some(p => p.channel === c.channel && p.callSign === c.callSign));
  const note = pressureBoundary ? 'Near a published FL boundary. Confirm the pressure-altitude reference and ATS channel.' : primary.length > 1 ? 'Multiple published channels. Confirm the active channel with ATS.' : undefined;
  const withheld = data.withheldAreas?.find(a => lon >= a.bounds[0] && lon <= a.bounds[2] && lat >= a.bounds[1] && lat <= a.bounds[3]);
  if (withheld) return { primary: [], alternatives: [...primary, ...alternatives], note: `${withheld.name}: local radio-area geometry requires chart review. Choose a channel manually.` };
  return { primary, alternatives, note: note || (primary.length ? undefined : 'No imported ATS radio area at this position and altitude. Check the AIP.') };
}
function identity(s: Omit<FrequencySegment, 'startNm' | 'endNm'>): string {
  return JSON.stringify([s.primary.map(c => [c.channel, c.callSign, c.area.id, c.role]), s.alternatives.map(c => [c.channel, c.callSign, c.area.id, c.role]), s.note]);
}
function edgeCrossing(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): number | null {
  const x = b[0] - a[0], y = b[1] - a[1], u = d[0] - c[0], v = d[1] - c[1];
  const det = x * v - y * u;
  if (Math.abs(det) < 1e-14) return null;
  const t = ((c[0] - a[0]) * v - (c[1] - a[1]) * u) / det;
  const s = ((c[0] - a[0]) * y - (c[1] - a[1]) * x) / det;
  return t > EPS && t < 1 - EPS && s >= -EPS && s <= 1 + EPS ? t : null;
}
/** Follow the plotted path, split at polygon intersections and altitude-limit crossings.
 * Great-circle arcs are represented by chords no longer than 1 NM. Handoffs are planning estimates.
 */
export function planLegFrequencies(leg: RouteLeg, data: RadioCatalog, altitudeAt: (distanceNm: number) => number | null, altitudeBreaks: number[] = []): FrequencySegment[] {
  if (leg.distanceNm <= EPS) return [];
  const checkpoints = [0, leg.distanceNm, ...altitudeBreaks.filter(n => n > 0 && n < leg.distanceNm)];
  const steps = Math.ceil(leg.distanceNm); for (let i = 1; i < steps; i++) checkpoints.push(i * leg.distanceNm / steps);
  const path = routeLegPath(leg); let along = 0;
  for (let i = 1; i < path.length - 1; i++) { along += greatCircleDistanceNm(path[i - 1], path[i]); checkpoints.push(along); }
  const positions = [...new Set(checkpoints)].sort((a, b) => a - b), result: FrequencySegment[] = [];
  for (let i = 1; i < positions.length; i++) {
    const start = positions[i - 1], end = positions[i], a = coordinateAtRouteDistance([leg], start)!, b = coordinateAtRouteDistance([leg], end)!;
    const altA = altitudeAt(start), altB = altitudeAt(end), fractions = [0, 1];
    for (const area of data.airspaces) for (const volume of area.volumes) {
      const box = bbox(volume);
      if (Math.max(a.lon, b.lon) < box[0] || Math.min(a.lon, b.lon) > box[2] || Math.max(a.lat, b.lat) < box[1] || Math.min(a.lat, b.lat) > box[3]) continue;
      for (let n = 1; n < volume.polygon.length; n++) {
        const t = edgeCrossing([a.lon, a.lat], [b.lon, b.lat], volume.polygon[n - 1], volume.polygon[n]); if (t !== null) fractions.push(t);
      }
      if (altA !== null && altB !== null && Math.abs(altB - altA) > EPS) for (const boundary of [floor(volume), ceiling(volume)]) {
        const t = (boundary - altA) / (altB - altA); if (t > EPS && t < 1 - EPS) fractions.push(t);
      }
    }
    for (const area of data.withheldAreas ?? []) {
      const [x, y, X, Y] = area.bounds, corners: [number, number][] = [[x,y],[X,y],[X,Y],[x,Y],[x,y]];
      for (let n = 1; n < corners.length; n++) { const t = edgeCrossing([a.lon,a.lat],[b.lon,b.lat],corners[n-1],corners[n]); if (t !== null) fractions.push(t); }
    }
    const cuts = [...new Set(fractions)].sort((a, b) => a - b);
    for (let n = 1; n < cuts.length; n++) {
      const x = start + cuts[n - 1] * (end - start), y = start + cuts[n] * (end - start); if (y - x < 1e-6) continue;
      const middle = (x + y) / 2, point = coordinateAtRouteDistance([leg], middle)!;
      const choice = selectAt(data, point.lon, point.lat, altitudeAt(middle));
      const previous = result.at(-1);
      if (previous && identity(previous) === identity(choice)) previous.endNm = y;
      else result.push({ startNm: x, endNm: y, ...choice });
    }
  }
  return result;
}
