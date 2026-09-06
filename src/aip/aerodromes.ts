export interface AipAerodrome {
  icao: string;
  name: string;
  elevationFt: number;
  lat: number | null;
  lon: number | null;
  sourceUrl: string;
}

export interface AipAerodromeCatalog {
  source: string;
  effectiveDate: string;
  generatedAt: string;
  issueUrl: string;
  aerodromes: AipAerodrome[];
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

export async function loadAipAerodromeCatalog(): Promise<AipAerodromeCatalog> {
  if (!catalogPromise) {
    const url = new URL('aip-aerodromes.json', document.baseURI).toString();
    catalogPromise = fetch(url, { cache: 'no-cache' }).then(async (response) => {
      if (!response.ok) {
        throw new Error(`AIP aerodrome data could not be loaded (${response.status}).`);
      }
      const data = await response.json() as AipAerodromeCatalog;
      if (!Array.isArray(data.aerodromes)) {
        throw new Error('AIP aerodrome data is not in the expected format.');
      }
      return data;
    }).catch((error) => {
      catalogPromise = null;
      throw error;
    });
  }
  return catalogPromise;
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
