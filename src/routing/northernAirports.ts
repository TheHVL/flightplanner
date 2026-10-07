import type { AipAerodrome, AipAerodromeCatalog } from '../aip/aerodromes';

/** Mainland AIP aerodromes at or north of Trondheim, derived from current data. */
export function northernAirports(catalog: AipAerodromeCatalog): AipAerodrome[] {
  const southernLatitude = catalog.aerodromes.find(a => a.icao === 'ENVA')?.lat ?? 63.4575;
  return catalog.aerodromes.filter(a => a.lat !== null && a.lon !== null && a.lat >= southernLatitude && a.lat < 72 &&
    (!a.runways || a.runways.some(r => /^\d{2}[LRC]?$/.test(r.designator))))
    .sort((a, b) => a.icao.localeCompare(b.icao));
}
