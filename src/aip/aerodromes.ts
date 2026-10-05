export interface AipAerodrome {
  icao: string;
  name: string;
  elevationFt: number;
  lat: number | null;
  lon: number | null;
  sourceUrl: string;
  runways?: AipRunway[];
  frequencies?: AipFrequency[];
  transitionAltitudeFt?: number | null;
  localRegulations?: string;
  circuitNotes?: string;
  flightProcedures?: string;
  charts?: AipChart[];
}

export interface AipRunway {
  designator: string;
  trueBearingDeg: number | null;
  lengthM: number | null;
  widthM: number | null;
  surface: string;
  toraM?: number | null;
  todaM?: number | null;
  asdaM?: number | null;
  ldaM?: number | null;
  remarks?: string;
}

export interface AipFrequency {
  service: string;
  callSign: string;
  frequencyMHz: string;
  hours: string;
  remarks: string;
}

export interface AipChart { title: string; sourceUrl: string; sha256?: string; }
export interface AipReportingPoint {
  id: string;
  name: string;
  aerodromeIcao: string;
  lat: number;
  lon: number;
  sourceUrl: string;
  remarks?: string;
}
export interface AipVfrRoute {
  id: string;
  name: string;
  aerodromeIcao: string;
  pointIds: string[];
  sourceUrl: string;
  remarks: string;
}
export interface AipRefreshStatus {
  state: 'success' | 'failed';
  attemptedAt: string;
  effectiveDate: string | null;
  error?: string;
}

export interface AipAerodromeCatalog {
  source: string;
  effectiveDate: string;
  generatedAt: string;
  issueUrl: string;
  aerodromes: AipAerodrome[];
  reportingPoints?: AipReportingPoint[];
  vfrRoutes?: AipVfrRoute[];
  checkedAt?: string;
  nextEffectiveDate?: string | null;
  publicationDate?: string | null;
  coverageWarnings?: string[];
}

let catalogPromise: Promise<AipAerodromeCatalog> | null = null;

export function normalizeIcao(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
}

export function findAipAerodromeInCatalog(
  catalog: AipAerodromeCatalog,
  icaoInput: string,
): AipAerodrome | null {
  const icao = normalizeIcao(icaoInput);
  if (icao.length !== 4) return null;
  return catalog.aerodromes.find((aerodrome) => aerodrome.icao === icao) ?? null;
}

export async function loadAipAerodromeCatalog(force = false): Promise<AipAerodromeCatalog> {
  if (force) catalogPromise = null;
  if (!catalogPromise) {
    const url = new URL('aip-aerodromes.json', document.baseURI).toString();
    catalogPromise = fetch(url, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`AIP aerodrome data could not be loaded (${response.status}).`);
      }
      const data = await response.json() as AipAerodromeCatalog;
      validateAipCatalog(data);
      return data;
    }).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
}

export function validateAipCatalog(data: AipAerodromeCatalog): void {
  if (!data || !Array.isArray(data.aerodromes) || !/^\d{4}-\d{2}-\d{2}$/.test(data.effectiveDate)) throw new Error('AIP catalog is not in the expected format.');
  const coordinates = (lat: number | null, lon: number | null) => lat === null && lon === null ||
    typeof lat === 'number' && Number.isFinite(lat) && Math.abs(lat) <= 90 && typeof lon === 'number' && Number.isFinite(lon) && Math.abs(lon) <= 180;
  const safeUrl = (url: string) => { try { const parsed = new URL(url); return parsed.protocol === 'https:' && parsed.hostname === 'aim-prod.avinor.no'; } catch { return false; } };
  if (data.aerodromes.some(ad => !/^EN[A-Z]{2}$/.test(ad.icao) || !Number.isFinite(ad.elevationFt) || !coordinates(ad.lat, ad.lon) || !safeUrl(ad.sourceUrl))) throw new Error('AIP catalog contains invalid aerodrome data.');
  const points = data.reportingPoints ?? [];
  const pointIds = new Set(points.map(point => point.id));
  if (pointIds.size !== points.length || points.some(point => !point.id || !point.name || point.lat === null || point.lon === null || !coordinates(point.lat, point.lon) || !safeUrl(point.sourceUrl))) throw new Error('AIP catalog contains invalid reporting points.');
  if ((data.vfrRoutes ?? []).some(route => route.pointIds.length < 2 || route.pointIds.some(id => !pointIds.has(id)) || !safeUrl(route.sourceUrl))) throw new Error('AIP catalog contains an unresolved VFR route.');
}

export function aipFreshness(catalog: AipAerodromeCatalog, status: AipRefreshStatus | null, now = new Date()): { warning: boolean; message: string } {
  if (catalog.effectiveDate > now.toISOString().slice(0, 10)) return { warning: true, message: 'This AIP edition is not yet effective. Do not use it for today’s flight.' };
  if (status?.state === 'failed') return { warning: true, message: `AIP refresh failed at ${status.attemptedAt}. Showing the last successful snapshot, effective ${catalog.effectiveDate}.` };
  if (catalog.nextEffectiveDate && now.toISOString().slice(0, 10) >= catalog.nextEffectiveDate) return { warning: true, message: `A newer published edition is now due (${catalog.nextEffectiveDate}). Reload the catalog and verify the official AIP.` };
  const checkedAt = status?.state === 'success' && status.effectiveDate === catalog.effectiveDate ? status.attemptedAt : catalog.checkedAt;
  if (!checkedAt || !Number.isFinite(Date.parse(checkedAt)) || now.getTime() - Date.parse(checkedAt) > 48 * 3600 * 1000) return { warning: true, message: 'Current AIP edition has not been verified within 48 hours. Check Avinor before relying on these data.' };
  return { warning: false, message: `Avinor edition checked ${checkedAt.slice(0, 16).replace('T', ' ')} UTC. Effective ${catalog.effectiveDate}.` };
}

export async function findAipAerodrome(icaoInput: string): Promise<{
  aerodrome: AipAerodrome;
  catalog: AipAerodromeCatalog;
}> {
  const icao = normalizeIcao(icaoInput);
  if (icao.length !== 4) {
    throw new Error('Enter a four-letter ICAO aerodrome code, for example ENTC.');
  }
  const catalog = await loadAipAerodromeCatalog();
  const aerodrome = findAipAerodromeInCatalog(catalog, icao);
  if (!aerodrome) {
    throw new Error(`${icao} was not found in the bundled Avinor AIP aerodrome data.`);
  }
  return { aerodrome, catalog };
}
