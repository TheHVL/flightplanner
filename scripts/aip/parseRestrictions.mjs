import { load } from 'cheerio';
import { cleanText, parseCoordinate, tableRows } from './parse.mjs';
import { parsePublishedVolumes } from './parseFrequencies.mjs';

const coordinates = text => [...text.matchAll(/(\d{6}(?:\.\d+)?[NS])\s*(\d{7}(?:\.\d+)?[EW])/g)]
  .map(m => [parseCoordinate(m[2]), parseCoordinate(m[1])]);
function circle(center, radiusNm) {
  const rad = Math.PI / 180, lat = center[1] * rad, lon = center[0] * rad;
  // Circumscribe the published circle. Chords must not cut inside its radius.
  const distance = radiusNm * 1852 / Math.cos(Math.PI / 180) / 6371008.8;
  const polygon = Array.from({ length: 180 }, (_, i) => {
    const bearing = i * 2 * rad;
    const y = Math.asin(Math.sin(lat) * Math.cos(distance) + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
    const x = lon + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat), Math.cos(distance) - Math.sin(lat) * Math.sin(y));
    return [x / rad, y / rad];
  });
  return [...polygon, polygon[0]];
}
function conservativeBounds(text) {
  const points = coordinates(text);
  if (!points.length || points.some(p => p.includes(null))) throw new Error('Restriction has no valid location.');
  const radii = [...text.matchAll(/radius\s+([\d.]+)(?:\s*-\s*([\d.]+))?\s*NM/gi)].flatMap(m => [Number(m[1]), Number(m[2] ?? m[1])]);
  if (/arc|sector|circle/i.test(text) && !radii.length) throw new Error('Cannot bound unsupported curved restriction geometry.');
  const radius = Math.max(0, ...radii) * 1852 / 6371008.8, rad = Math.PI / 180;
  const latMin = Math.min(...points.map(p => p[1])) - radius / rad, latMax = Math.max(...points.map(p => p[1])) + radius / rad;
  const extent = points.map(p => Math.asin(Math.min(1, Math.sin(radius) / Math.cos(p[1] * rad))) / rad);
  const west = Math.min(...points.map((p, i) => p[0] - extent[i])), east = Math.max(...points.map((p, i) => p[0] + extent[i]));
  if (latMin <= -90 || latMax >= 90 || west < -180 || east > 180) throw new Error('Restriction bounds exceed supported coordinates.');
  return [[west, latMin], [east, latMin], [east, latMax], [west, latMax], [west, latMin]];
}

/** ENR 5.1 publication geometry only. No schedule/NOTAM is interpreted as active or inactive. */
export function parsePublishedRestrictions(html, sourceUrl, borderResolver) {
  const $ = load(html);
  $('script,style,.gutter,.sdParams,.acParams,.AmdtDeletedAIRAC,.AmdtDeleted,.Deleted,.deleted,del').remove();
  $('br').replaceWith(' '); $('p,li,div').each((_, element) => $(element).append(' '));
  const rows = tableRows(null, $.html()).filter(row => /^EN[PRD]\d+$/.test(row[0] ?? ''));
  if (!rows.length) throw new Error('No published ENR 5.1 restriction areas found.');
  const ids = new Set(), warnings = [];
  const areas = rows.map(([id, lateral, vertical, remarks = '']) => {
    if (ids.has(id)) throw new Error(`Duplicate restriction area: ${id}`);
    ids.add(id);
    const firstCoordinate = lateral.search(/\d{6}(?:\.\d+)?[NS]/);
    if (firstCoordinate < 0) throw new Error(`${id}: restriction location is unavailable.`);
    const name = cleanText(lateral.slice(0, firstCoordinate)), geometry = lateral.slice(firstCoordinate);
    // MSL is a sea-level zero, not a ground-relative lower surface.
    const normalized = vertical.replace(/\bMSL\b/g, '0 FT AMSL');
    let volumes, limits, unresolvedGeometry = false, verticalLimitsUnknown = false;
    const limitsPolygon = '000000N 0000000E - 000000N 0010000E - 010000N 0010000E - (000000N 0000000E) ';
    try { limits = parsePublishedVolumes(limitsPolygon + normalized)[0]; }
    catch {
      verticalLimitsUnknown = true;
      // These book-keeping limits never establish a vertical clearance: the
      // explicit unknown flag forces review, and search avoids the footprint.
      limits = { lower: { reference: 'GND', value: 0 }, upper: { reference: 'UNL', value: null } };
      warnings.push(`${id}: vertical limits require publication/NOTAM review.`);
    }
    try {
      const match = geometry.match(/^(\d{6}[NS]\s*\d{7}[EW])\s*-\s*A circle with radius ([\d.]+) NM$/i);
      if (match) {
        volumes = [{ lower: limits.lower, upper: limits.upper, polygon: circle(coordinates(match[1])[0], Number(match[2])), publishedLimits: cleanText(vertical) }];
      } else volumes = parsePublishedVolumes(`${geometry} Upper limit: UNL Lower limit: GND`, borderResolver)
        .map(v => ({ polygon: v.polygon, lower: limits.lower, upper: limits.upper, publishedLimits: cleanText(vertical) }));
    } catch (error) {
      // Retain a bounded review footprint instead of silently dropping a published area.
      const polygon = conservativeBounds(geometry);
      volumes = [{ polygon, lower: limits.lower, upper: limits.upper, publishedLimits: cleanText(vertical) || 'Limits require NOTAM review' }];
      unresolvedGeometry = true;
      warnings.push(`${id}: conservative review footprint; ${error.message}`);
    }
    return { id, name: `${id} · ${name}`, type: id[2], sourceUrl, volumes, remarks, activation: 'unknown',
      ...(unresolvedGeometry ? { unresolvedGeometry: true } : {}), ...(verticalLimitsUnknown ? { verticalLimitsUnknown: true } : {}) };
  });
  return { areas, warnings, publishedAreaCount: rows.length };
}
