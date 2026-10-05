import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { load } from 'cheerio';
import { resolveIssue, discoverAerodromePages, parseAerodromePage, parseReportingPointBbox, annotateReportingPoints, verifiedRoutes } from './aip/parse.mjs';

const HOME = 'https://aim-prod.avinor.no/no/AIP/';
const OUTPUT = new URL('../public/aip-aerodromes.json', import.meta.url);
const STATUS = new URL('../public/aip-status.json', import.meta.url);
const attempt = new Date().toISOString();
const sourcesDir = process.env.AIP_SOURCES_DIR;
let effectiveDate = null;
async function request(url) {
  let error;
  for (let n = 0; n < 3; n++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000), headers: { 'user-agent': 'Flightplanner AIP refresh', accept: '*/*' } });
      if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
      if (new URL(response.url).hostname !== 'aim-prod.avinor.no' || /NewAipAvailable/.test(response.url)) throw new Error(`Unexpected AIP redirect: ${response.url}`);
      return response;
    } catch (caught) { error = caught; }
  }
  throw error;
}
async function text(url) { const response = await request(url); return { text: await response.text(), url: response.url }; }
async function main() {
  const previous = JSON.parse(await readFile(OUTPUT, 'utf8'));
  const history = await text(HOME);
  const issue = resolveIssue(history.text, history.url);
  effectiveDate = issue.effectiveDate;
  if (effectiveDate < previous.effectiveDate) throw new Error('Refusing to downgrade the AIP edition.');
  const tocUrl = new URL('eAIP/EN-menu-en-GB.html', issue.issueRoot).toString();
  const toc = await text(tocUrl);
  let pages = discoverAerodromePages(toc.text, toc.url);
  if (pages.size < 20) {
    const adIndex = await text(new URL('eAIP/EN-AD-1.3-en-GB.html', issue.issueRoot).toString());
    pages = new Map([...pages, ...discoverAerodromePages(adIndex.text, adIndex.url)]);
    // AD 1.3 may print codes instead of linking each AD 2 chapter.
    const $ = load(adIndex.text);
    for (const match of $.text().matchAll(/\bEN[A-Z]{2}\b/g)) {
      if (!pages.has(match[0])) pages.set(match[0], new URL(`eAIP/EN-AD-2.${match[0]}-en-GB.html`, issue.issueRoot).toString());
    }
  }
  if (pages.size < 20) throw new Error(`Only ${pages.size} AD 2 chapters discovered.`);
  if (sourcesDir) { await mkdir(sourcesDir, { recursive: true }); await writeFile(join(sourcesDir, 'history.html'), history.text); }
  const aerodromes = [], reportingPoints = [], chartSources = [], coverageWarnings = [];
  const temporary = await mkdtemp(join(tmpdir(), 'flightplanner-aip-'));
  try {
    for (const [icao, url] of [...pages].sort()) {
      const page = await text(url);
      if (sourcesDir) await writeFile(join(sourcesDir, `${icao}.html`), page.text);
      const ad = parseAerodromePage(icao, page.text, page.url);
      if (ad.lat === null || ad.lon === null || ad.runways.length === 0 || ad.frequencies.length === 0) throw new Error(`${icao}: incomplete AD 2 import`);
      for (const [index, chart] of ad.charts.entries()) {
        const pdf = Buffer.from(await (await request(chart.sourceUrl)).arrayBuffer());
        if (!pdf.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error(`${icao}: chart is not a PDF`);
        chart.sha256 = createHash('sha256').update(pdf).digest('hex');
        chartSources.push({ ...chart, aerodromeIcao: icao });
        const file = join(temporary, `${icao}-${index}.pdf`);
        await writeFile(file, pdf);
        if (sourcesDir) await writeFile(join(sourcesDir, `${icao}-${index}.pdf`), pdf);
        const chartText = execFileSync('pdftotext', ['-bbox-layout', file, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const plainText = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
        const parsed = annotateReportingPoints(parseReportingPointBbox(icao, chartText, chart.sourceUrl), chart.title, plainText);
        for (const point of parsed) {
          const existing = reportingPoints.find(candidate => candidate.id === point.id);
          if (existing && (existing.lat !== point.lat || existing.lon !== point.lon)) throw new Error(`Conflicting published point ${point.id}`);
          if (!existing) reportingPoints.push(point);
        }
        if (parsed.length === 0) coverageWarnings.push(`${icao}: no machine-readable coordinate table in ${chart.title}. Open the published chart.`);
      }
      aerodromes.push(ad);
      console.log(`${icao}: ${ad.runways.length} runway ends, ${ad.frequencies.length} frequencies, ${ad.charts.length} VFR charts`);
    }
  } finally { await rm(temporary, { recursive: true, force: true }); }
  for (const old of previous.aerodromes) if (!aerodromes.some(ad => ad.icao === old.icao)) throw new Error(`Previously covered ${old.icao} missing; refusing partial replacement.`);
  const definitions = JSON.parse(await readFile(new URL('./aip/verified-vfr-routes.json', import.meta.url), 'utf8'));
  const vfrRoutes = verifiedRoutes(definitions, chartSources, reportingPoints);
  for (const route of definitions) if (!vfrRoutes.some(item => item.id === route.id)) coverageWarnings.push(`${route.aerodromeIcao}: route ${route.name} withheld because its source changed or a point is missing.`);
  const catalog = { source: 'Avinor AIP Norway', ...issue, generatedAt: attempt, checkedAt: attempt, aerodromes, reportingPoints, vfrRoutes, coverageWarnings };
  // Replace only after ALL mandatory data and charts have succeeded. Never combine
  // records from different editions or silently certify a partial import as current.
  const staged = new URL('../public/aip-aerodromes.json.tmp', import.meta.url);
  await writeFile(staged, JSON.stringify(catalog, null, 2) + '\n');
  await rename(staged, OUTPUT);
  await writeFile(STATUS, JSON.stringify({ state: 'success', attemptedAt: attempt, effectiveDate }, null, 2) + '\n');
  console.log(`Refreshed ${aerodromes.length} aerodromes, ${reportingPoints.length} points, ${vfrRoutes.length} verified route sequences. Effective ${effectiveDate}.`);
}
main().catch(async error => {
  console.error(error);
  await writeFile(STATUS, JSON.stringify({ state: 'failed', attemptedAt: attempt, effectiveDate, error: error.message }, null, 2) + '\n');
  process.exitCode = 1;
});
