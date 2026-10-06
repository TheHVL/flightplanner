import { readFile, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
const runFile = promisify(execFile);
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load } from 'cheerio';
import { resolveIssue, parseAerodromeAirspaceDescription, parseCoordinate } from './aip/parse.mjs';
import { createBorderResolver } from './aip/countryBorder.mjs';
import { parsePolarisSectors, parseTerminalAirspaces, parseAerodromeRadioArea, sectionByTitle } from './aip/parseFrequencies.mjs';
import { parsePublishedRestrictions } from './aip/parseRestrictions.mjs';
const output = new URL('../public/aip-frequencies.json', import.meta.url);
const statusFile = new URL('../public/aip-frequency-status.json', import.meta.url);
const attemptedAt = new Date().toISOString(); let effectiveDate = null;
async function request(url) {
  // curl also respects standard proxy settings in hosted development environments.
  // Validate the effective host and response before accepting downloaded bytes.
  const temporary = await mkdtemp(join(tmpdir(), 'flightplanner-source-'));
  try {
    const file = join(temporary, 'source');
    const { stdout: info } = await runFile('curl', ['--silent', '--show-error', '--location', '--fail', '--max-time', '25', '--retry', '2', '--output', file, '--write-out', '%{http_code} %{url_effective}', url], { encoding: 'utf8', timeout: 85000, maxBuffer: 1024 * 1024 });
    const [code, finalUrl] = info.trim().split(' ');
    if (code !== '200' || /NewAipAvailable/.test(finalUrl) || new URL(finalUrl).hostname !== new URL(url).hostname) throw new Error('Unexpected source response or redirect.');
    const bytes = await readFile(file);
    return { url: finalUrl, arrayBuffer: async () => bytes };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function source(url) { const r = await request(url); const bytes = Buffer.from(await r.arrayBuffer()); return { url: r.url, sha256: createHash('sha256').update(bytes).digest('hex'), bytes }; }
function linkByTitle(xml, pattern) {
  const $ = load(xml, { xmlMode: true });
  const entry = $('entry').get().find(e => pattern.test($(e).children('title').text()));
  if (!entry) throw new Error('Kartverket boundary download could not be discovered.');
  const href = $(entry).children('link[rel="alternate"]').first().attr('href');
  if (!href) throw new Error('Boundary dataset download link is missing.');
  const url = new URL(href); url.protocol = 'https:';
  if (url.hostname !== 'nedlasting.geonorge.no') throw new Error('Unexpected boundary download host.');
  return url.toString();
}
async function borderData() {
  // Download URLs are discovered from the public official feed, never guessed.
  const serviceFeed = await source('https://nedlasting.geonorge.no/geonorge/Tjenestefeed.xml');
  const feed = await source(linkByTitle(serviceFeed.bytes.toString(), /^Administrative enheter fylker GeoJSON-format$/));
  const $ = load(feed.bytes.toString(), { xmlMode: true });
  const entry = $('entry').get().find(e => /Landsdekkende/.test($(e).children('title').text()) && $(e).children('link[rel="alternate"]').get().some(l => /4258/.test($(l).attr('href') ?? '')));
  if (!entry) throw new Error('Country-border GeoJSON download not found.');
  const href = $(entry).children('link[rel="alternate"]').get().map(l => $(l).attr('href')).find(h => /4258/.test(h ?? ''));
  const url = new URL(href); url.protocol = 'https:';
  if (url.hostname !== 'nedlasting.geonorge.no') throw new Error('Unexpected country-border download host.');
  const data = await source(url.toString());
  const temporary = await mkdtemp(join(tmpdir(), 'flightplanner-border-'));
  let features;
  try {
    const file = join(temporary, 'border.zip'); await writeFile(file, data.bytes);
    const json = execFileSync('python3', ['-c', 'import zipfile,json,sys;z=zipfile.ZipFile(sys.argv[1]);names=[n for n in z.namelist() if n.lower().endswith(".geojson")];assert len(names)==1;print(z.read(names[0]).decode("utf-8-sig"))', file], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
    const parsed = JSON.parse(json);
    if (!/4258/.test(JSON.stringify(parsed.crs))) throw new Error('Unexpected country-border CRS.');
    features = parsed.features;
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { resolver: createBorderResolver(features), metadata: { source: 'Kartverket administrative boundaries', sourceUrl: 'https://www.kartverket.no/api-og-data/grensedata', license: 'CC BY 4.0', sha256: data.sha256, simplificationMeters: 20 } };
}
async function main() {
  const history = await source('https://aim-prod.avinor.no/no/AIP/');
  const issue = resolveIssue(history.bytes.toString(), history.url); effectiveDate = issue.effectiveDate;
  const catalog = JSON.parse(await readFile(new URL('../public/aip-aerodromes.json', import.meta.url), 'utf8'));
  const airportStatus = JSON.parse(await readFile(new URL('../public/aip-status.json', import.meta.url), 'utf8'));
  if (airportStatus.state !== 'success' || airportStatus.effectiveDate !== effectiveDate || !Number.isFinite(Date.parse(airportStatus.attemptedAt)) || Date.parse(attemptedAt) - Date.parse(airportStatus.attemptedAt) > 48 * 3600 * 1000) throw new Error('A successful current-edition aerodrome refresh is required before updating channels.');
  if (catalog.effectiveDate !== effectiveDate) throw new Error('Frequency and aerodrome data must use the same current AIP edition.');
  let previous; try { previous = JSON.parse(await readFile(output, 'utf8')); } catch { /* First import. */ }
  if (previous?.effectiveDate > effectiveDate) throw new Error('Refusing a frequency-data edition downgrade.');
  const [enr21, enr22, enr51, border] = await Promise.all([
    source(new URL('eAIP/EN-ENR-2.1-en-GB.html', issue.issueRoot).toString()),
    source(new URL('eAIP/EN-ENR-2.2-en-GB.html', issue.issueRoot).toString()),
    source(new URL('eAIP/EN-ENR-5.1-en-GB.html', issue.issueRoot).toString()), borderData(),
  ]);
  const sectors = parsePolarisSectors(enr22.bytes.toString(), enr22.url, border.resolver);
  if (sectors.length < 29 || new Set(sectors.map(s => s.id)).size !== sectors.length) throw new Error('Polaris sector import is incomplete.');
  for (const prior of previous?.airspaces?.filter(s => s.type === 'sector') ?? []) if (!sectors.some(s => s.id === prior.id)) throw new Error(`Previously covered sector missing: ${prior.name}`);
  const terminals = parseTerminalAirspaces(enr21.bytes.toString(), enr21.url, border.resolver);
  if (terminals.spaces.filter(s => s.type === 'TMA').length < 20) throw new Error('TMA radio-area import is incomplete.');
  const warnings = [...terminals.warnings], extra = [];
  const restrictions = parsePublishedRestrictions(enr51.bytes.toString(), enr51.url, border.resolver);
  for (const prior of previous?.restrictions ?? []) if (!restrictions.areas.some(area => area.id === prior.id)) {
    // A genuine publication removal is possible, but requires review before reducing coverage.
    throw new Error(`Previously covered restriction missing: ${prior.id}. Review its published removal.`);
  }
  warnings.push(...restrictions.warnings);
  for (const pattern of [/Traffic Information Areas/i]) {
    const part = parseTerminalAirspaces(sectionByTitle(enr22.bytes.toString(), pattern), enr22.url, border.resolver);
    extra.push(...part.spaces); warnings.push(...part.warnings);
  }
  // Legacy airport snapshots do not yet contain AD 2.17. Read those chapters
  // in bounded batches. Future aerodrome refreshes include the raw description.
  const aerodromeAreas = [], withheldAreas = [];
  for (let i = 0; i < catalog.aerodromes.length; i += 6) {
    await Promise.all(catalog.aerodromes.slice(i, i + 6).map(async ad => {
      const description = ad.atsAirspace ?? parseAerodromeAirspaceDescription(ad.icao, (await source(ad.sourceUrl)).bytes.toString());
      try { const area = parseAerodromeRadioArea(ad, description, border.resolver); if (area) aerodromeAreas.push(area); }
      catch (error) {
        warnings.push(`${ad.icao}: radio-area geometry withheld. ${error.message}`);
        const coordinates = [...description.lateralLimits.matchAll(/(\d{6}(?:\.\d+)?[NS])\s*(\d{7}(?:\.\d+)?[EW])/g)].map(m => [parseCoordinate(m[2]), parseCoordinate(m[1])]);
        if (!coordinates.length && ad.lon !== null && ad.lat !== null) coordinates.push([ad.lon, ad.lat]);
        if (coordinates.length) {
          // Bound unsupported arcs/circles conservatively; never infer a local channel.
          const radius = description.lateralLimits.match(/radius (?:of )?([\d.]+) NM/i);
          const nm = radius ? Number(radius[1]) + 1 : coordinates.length === 1 ? 20 : 2;
          const latitude = coordinates[0][1], dy = nm / 60, dx = dy / Math.cos(latitude * Math.PI / 180);
          withheldAreas.push({ name: `${ad.icao} local ATS area`, bounds: [Math.min(...coordinates.map(c => c[0])) - dx, Math.min(...coordinates.map(c => c[1])) - dy, Math.max(...coordinates.map(c => c[0])) + dx, Math.max(...coordinates.map(c => c[1])) + dy], sourceUrl: ad.sourceUrl });
        } else throw new Error(`${ad.icao}: cannot bound unsupported local radio geometry.`);
      }
    }));
  }
  const airspaces = [...sectors, ...terminals.spaces, ...extra, ...aerodromeAreas].sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(airspaces.map(s => s.id)).size !== airspaces.length) throw new Error('Duplicate imported radio-area ID.');
  const payload = { schemaVersion: 1, source: 'Avinor AIP Norway', ...issue, checkedAt: attemptedAt, generatedAt: attemptedAt,
    sources: [enr21, enr22, enr51].map(({url, sha256}) => ({url, sha256})), boundarySource: border.metadata, airspaces, withheldAreas, coverageWarnings: warnings,
    restrictions: restrictions.areas, restrictionCoverage: { sourceUrl: enr51.url, sha256: enr51.sha256, publishedAreaCount: restrictions.publishedAreaCount } };
  const staged = new URL('../public/aip-frequencies.json.tmp', import.meta.url);
  await writeFile(staged, JSON.stringify(payload) + '\n'); await rename(staged, output);
  await writeFile(statusFile, JSON.stringify({ state: 'success', attemptedAt, effectiveDate }, null, 2) + '\n');
  console.log(`Imported ${sectors.length} Polaris sectors and ${airspaces.length - sectors.length} ATS radio areas, AIP ${effectiveDate}.`);
  console.log(`Imported ${restrictions.areas.length} ENR 5.1 restriction footprints; activation remains unknown.`);
  for (const warning of warnings) console.warn(warning);
}
main().catch(async error => { console.error(error.message); await writeFile(statusFile, JSON.stringify({ state: 'failed', attemptedAt, effectiveDate, error: error.message }, null, 2) + '\n'); process.exitCode = 1; });
