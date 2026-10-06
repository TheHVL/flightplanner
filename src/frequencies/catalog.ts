import { aipFreshness, type AipRefreshStatus, type AipAerodromeCatalog } from '../aip/aerodromes';
export interface RadioLimit { reference: 'GND' | 'UNL' | 'AMSL' | 'AGL' | 'FL'; value: number | null; }
export interface RadioVolume { polygon: [number, number][]; lower: RadioLimit; upper: RadioLimit; publishedLimits: string; }
export interface RadioChannel { channel: string; callSign?: string; remarks?: string; }
export interface RadioArea {
  id: string; name: string; type: string; unit: string; callSign: string; channels: RadioChannel[];
  volumes: RadioVolume[]; hours: string; remarks: string; sourceUrl: string; unresolvedGeometry?: boolean;
}
export interface RadioCatalog {
  schemaVersion: 1; source: string; effectiveDate: string; checkedAt: string; generatedAt: string;
  issueUrl: string; nextEffectiveDate: string | null; airspaces: RadioArea[]; coverageWarnings: string[];
  withheldAreas?: Array<{ name: string; bounds: [number, number, number, number]; sourceUrl: string; }>;
  boundarySource: { source: string; sourceUrl: string; license: string; simplificationMeters: number; };
}
export function validateRadioCatalog(value: unknown): asserts value is RadioCatalog {
  const d = value as RadioCatalog;
  const sourceUrl = (s: unknown) => { try { const u = new URL(String(s)); return u.protocol === 'https:' && u.hostname === 'aim-prod.avinor.no'; } catch { return false; } };
  const limit = (l: RadioLimit) => l && ['GND', 'UNL', 'AMSL', 'FL', 'AGL'].includes(l.reference) &&
    (l.reference === 'UNL' ? l.value === null : typeof l.value === 'number' && Number.isFinite(l.value) && l.value >= 0 && l.value <= 100000);
  if (!d || d.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(d.effectiveDate) || !Number.isFinite(Date.parse(d.checkedAt)) ||
      !sourceUrl(d.issueUrl) || !d.boundarySource || typeof d.boundarySource.source !== 'string' || !Array.isArray(d.airspaces) || !d.airspaces.length || !Array.isArray(d.coverageWarnings)) throw new Error('ATS frequency data format is invalid.');
  const ids = new Set<string>();
  for (const area of d.airspaces) {
    if (!area || typeof area.id !== 'string' || ids.has(area.id) || [area.name, area.type, area.unit, area.callSign, area.hours, area.remarks].some(s => typeof s !== 'string') || !sourceUrl(area.sourceUrl) || !Array.isArray(area.channels) ||
        !area.channels.length || area.channels.some(c => !c || c.callSign !== undefined && typeof c.callSign !== 'string' || c.remarks !== undefined && typeof c.remarks !== 'string' || !/^1[123]\d\.\d{3}$/.test(c.channel) || Number(c.channel) < 118 || Number(c.channel) >= 137 || c.channel === '121.500') ||
        !Array.isArray(area.volumes) || !area.volumes.length || area.volumes.some(v => !v || typeof v.publishedLimits !== 'string' || !limit(v.lower) || !limit(v.upper) || v.upper.reference !== 'UNL' && (v.lower.value ?? 0) >= (v.upper.value ?? 0) || !Array.isArray(v.polygon) || v.polygon.length < 4 ||
          v.polygon.some(p => !Array.isArray(p) || p.length !== 2 || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || Math.abs(p[0]) > 180 || Math.abs(p[1]) > 90) ||
          v.polygon[0][0] !== v.polygon.at(-1)![0] || v.polygon[0][1] !== v.polygon.at(-1)![1])) throw new Error('ATS frequency data contain an invalid radio area.');
    ids.add(area.id);
  }
  if (d.withheldAreas !== undefined && (!Array.isArray(d.withheldAreas) || d.withheldAreas.some(a => !a || typeof a.name !== 'string' || !sourceUrl(a.sourceUrl) || !Array.isArray(a.bounds) || a.bounds.length !== 4 || a.bounds.some(n => !Number.isFinite(n)) || a.bounds[0] >= a.bounds[2] || a.bounds[1] >= a.bounds[3]))) throw new Error('Invalid ATS review area.');
}
export function radioFreshness(data: RadioCatalog, status: AipRefreshStatus | null, airports: AipAerodromeCatalog, now = new Date(), flightDate = ''): { usable: boolean; message: string; warning?: boolean } {
  if (data.effectiveDate !== airports.effectiveDate) return { usable: false, message: 'ATS and airport data use different AIP editions. Automatic channels are withheld.' };
  if (!status || status.effectiveDate !== data.effectiveDate) return { usable: false, message: 'The latest ATS data refresh could not verify this AIP edition. Automatic channels are withheld; check the official AIP.' };
  if (!Number.isFinite(Date.parse(data.checkedAt)) || now.getTime() - Date.parse(data.checkedAt) > 48 * 3600 * 1000 || Date.parse(data.checkedAt) > now.getTime() + 5 * 60 * 1000) return { usable: false, message: 'ATS source data have not been verified within 48 hours. Automatic channels are withheld.' };
  // A failed newer attempt does not invalidate a successful, same-edition snapshot
  // still inside the 48-hour limit. Its own check time remains authoritative.
  const check = aipFreshness({ ...airports, checkedAt: data.checkedAt, nextEffectiveDate: data.nextEffectiveDate }, null, now);
  if (check.warning) return { usable: false, message: `${check.message} Automatic channels are withheld.` };
  const date = flightDate.slice(0, 10) || now.toISOString().slice(0, 10);
  if (date < data.effectiveDate || data.nextEffectiveDate && date >= data.nextEffectiveDate) return { usable: false, message: 'The planned flight date is outside this AIP edition. Automatic channels are withheld.' };
  return { usable: true, warning: status.state === 'failed', message: `${status.state === 'failed' ? 'Latest ATS refresh failed. Using the last successful snapshot. ' : ''}${check.message} Published suggestions require ATS confirmation.` };
}
