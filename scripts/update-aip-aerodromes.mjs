import { writeFile } from 'node:fs/promises';

const AIP_HOME = 'https://aim-prod.avinor.no/no/AIP/';
const OUTPUT = new URL('../public/aip-aerodromes.json', import.meta.url);

// Aerodromes/heliports listed in AIP Norway AD 1.3. Missing AD 2 pages are skipped.
const AIRPORT_CODES = [
  'ENSS', 'ENMH', 'ENHV', 'ENBS', 'ENHK', 'ENBV', 'ENHF', 'ENVD', 'ENSR', 'ENTC',
  'ENAT', 'ENNA', 'ENKR', 'ENAN', 'ENDU', 'ENSK', 'ENEV', 'ENLK', 'ENVR', 'ENSH',
  'ENBO', 'ENRS', 'ENRA', 'ENST', 'ENBN', 'ENMS', 'ENRM', 'ENNM', 'ENOL', 'ENVA',
  'ENKB', 'ENAL', 'ENML', 'ENRO', 'ENOV', 'ENFL', 'ENSD', 'ENBL', 'ENSG', 'ENRE',
  'ENBH', 'ENBR', 'ENEG', 'ENGM', 'ENSO', 'ENAS', 'ENHD', 'ENNO', 'ENRY', 'ENKJ',
  'ENZV', 'ENSB', 'ENGK', 'ENTO', 'ENCN',
];

const requestHeaders = {
  accept: 'text/html,application/xhtml+xml',
  'user-agent': 'Flightplanner training tool - AIP aerodrome metadata refresh',
};

async function fetchText(url) {
  const response = await fetch(url, { redirect: 'follow', headers: requestHeaders });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return { text: await response.text(), url: response.url };
}

function decodeHtml(value) {
  return value
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&#160;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&deg;', '°')
    .replaceAll('&Oslash;', 'Ø')
    .replaceAll('&oslash;', 'ø')
    .replaceAll('&Aring;', 'Å')
    .replaceAll('&aring;', 'å')
    .replaceAll('&AElig;', 'Æ')
    .replaceAll('&aelig;', 'æ');
}

function plainText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\bT[A-Z0-9_]+;[A-Z0-9_]+;\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCoordinate(value) {
  const match = value.match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/i);
  if (!match) return null;
  const degrees = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return null;
  const decimal = degrees + minutes / 60 + seconds / 3600;
  return /[SW]/i.test(match[4]) ? -decimal : decimal;
}

function parseAerodromePage(icao, html, sourceUrl) {
  const text = plainText(html);
  const headingMatch = text.match(new RegExp(`\\b${icao}\\s*[—–-]\\s*(.{1,100}?)\\s+${icao}\\s+AD\\s+2\\.1`, 'i'));
  const name = (headingMatch?.[1] ?? icao)
    .replace(/\s+\/\s+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();

  const elevIndex = text.toUpperCase().indexOf('ELEV/REF TEMP/MEAN LOW TEMP');
  if (elevIndex < 0) return null;
  const elevSlice = text.slice(elevIndex, elevIndex + 220);
  const elevMatch = elevSlice.match(/ELEV\/REF TEMP\/MEAN LOW TEMP\s+([\d][\d\s,.]*?)\s+FT\b/i);
  if (!elevMatch) return null;
  const elevationFt = Number(elevMatch[1].replace(/[\s,]/g, ''));
  if (!Number.isFinite(elevationFt)) return null;

  const arpIndex = text.toUpperCase().indexOf('ARP COORDINATES AND SITE AT AD');
  const arpSlice = arpIndex >= 0 ? text.slice(arpIndex, arpIndex + 260) : '';
  const coordMatch = arpSlice.match(/(\d{6,7}(?:\.\d+)?[NS]).*?(\d{7,8}(?:\.\d+)?[EW])/i);
  const lat = coordMatch ? parseCoordinate(coordMatch[1]) : null;
  const lon = coordMatch ? parseCoordinate(coordMatch[2]) : null;

  return {
    icao,
    name,
    elevationFt,
    lat,
    lon,
    sourceUrl,
  };
}

async function resolveCurrentIssue() {
  const history = await fetchText(AIP_HOME);
  const match = history.text.match(/href=["']([^"']+\/\d{4}-\d{2}-\d{2}-AIRAC\/html\/index-(?:en-GB|no-NO)\.html[^"']*)["']/i);
  if (!match) throw new Error('Could not identify the current Avinor AIP issue from the AIP history page.');
  const issueUrl = new URL(match[1], history.url);
  const effectiveDate = issueUrl.pathname.match(/\/(\d{4}-\d{2}-\d{2})-AIRAC\//)?.[1] ?? '';
  const issueRoot = new URL('./', issueUrl);
  return { issueUrl: issueUrl.toString(), issueRoot, effectiveDate };
}

async function main() {
  const { issueUrl, issueRoot, effectiveDate } = await resolveCurrentIssue();
  const aerodromes = [];
  const failures = [];

  for (const icao of AIRPORT_CODES) {
    const pageUrl = new URL(`eAIP/EN-AD-2.${icao}-en-GB.html`, issueRoot).toString();
    try {
      const page = await fetchText(pageUrl);
      const parsed = parseAerodromePage(icao, page.text, page.url);
      if (parsed) aerodromes.push(parsed);
      else failures.push(`${icao}: no AD elevation found`);
    } catch (error) {
      failures.push(`${icao}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (aerodromes.length < 20) {
    throw new Error(`Only ${aerodromes.length} aerodromes were parsed from AIP, refusing to replace the fallback catalog.`);
  }

  aerodromes.sort((a, b) => a.icao.localeCompare(b.icao));
  const catalog = {
    source: 'Avinor AIP Norway',
    effectiveDate,
    generatedAt: new Date().toISOString(),
    issueUrl,
    aerodromes,
  };

  await writeFile(OUTPUT, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  console.log(`Updated ${aerodromes.length} AIP aerodromes, effective ${effectiveDate || 'unknown'}.`);
  if (failures.length > 0) console.warn(`Skipped ${failures.length}: ${failures.join(' | ')}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
