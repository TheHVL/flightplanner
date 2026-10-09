import { createServer } from 'vite';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Runs the application's actual routing/review pipeline without changing data
// or making blocked drafts transferable. Captures responses for comparisons.
const { values } = parseArgs({ options: {
  departure: { type: 'string' }, destination: { type: 'string' }, date: { type: 'string' },
  altitude: { type: 'string', default: '2500' }, minutes: { type: 'string', default: '45' },
  output: { type: 'string' }, curl: { type: 'boolean' }, replay: { type: 'boolean' }, help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node scripts/diagnose-generator.mjs --departure ICAO --destination ICAO --date YYYY-MM-DD --output /tmp/report.json [--altitude 2500] [--minutes 45] [--curl] [--replay]');
  console.log('Responses are saved beside the report in raw/. Replay uses only captured responses, not fresh provider data. Normal AIP freshness/profile checks still apply. --curl supports environments where Node fetch cannot reach the HTTPS proxy.');
  process.exit(0);
}
if (!values.departure || !values.destination || !values.output || !/^\d{4}-\d{2}-\d{2}$/.test(values.date ?? '') || !Number.isFinite(Date.parse(values.date))) {
  throw new Error('Departure, destination, valid date and output path are required; use --help.');
}
if (new Date(values.date).toISOString().slice(0, 10) !== values.date) throw new Error('Invalid calendar date.');
const altitudeFt = Number(values.altitude), lessonMinutes = Number(values.minutes);
if (!Number.isFinite(altitudeFt) || altitudeFt < 0 || !Number.isFinite(lessonMinutes) || lessonMinutes <= 0) throw new Error('Invalid altitude or lesson duration.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(values.output), raw = resolve(dirname(output), 'raw');
await mkdir(raw, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile), originalFetch = globalThis.fetch;
const requests = [];
globalThis.fetch = async (input, options = {}) => {
  const url = String(input), path = resolve(raw, hash(url));
  try {
    let body, metadata;
    if (values.replay) {
      metadata = JSON.parse(await readFile(`${path}.json`, 'utf8'));
      body = await readFile(path);
      if (metadata.url !== url || metadata.sha256 !== hash(body)) throw new Error('Captured response checksum/URL mismatch.');
    } else {
      let status;
      if (values.curl) {
        const { stdout } = await run('curl', ['--silent', '--show-error', '--max-time', '43', '--output', path, '--write-out', '%{http_code}', url], { signal: options.signal, maxBuffer: 1024 * 1024 });
        body = await readFile(path); status = Number(stdout);
      } else {
        const response = await originalFetch(input, options);
        body = Buffer.from(await response.arrayBuffer()); status = response.status;
        await writeFile(path, body);
      }
      metadata = { url, status, fetchedAt: new Date().toISOString(), bytes: body.length, sha256: hash(body) };
      await writeFile(`${path}.json`, JSON.stringify(metadata, null, 2));
    }
    requests.push(metadata);
    return new Response(body, { status: metadata.status });
  } catch (error) {
    requests.push({ url, failedAt: new Date().toISOString(), error: error.message });
    throw error;
  }
};

const server = await createServer({ root, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { generateRouteCandidates } = await server.ssrLoadModule('/src/generator/candidates.ts');
  const { reviewCandidates, candidateReviewBlocksTransfer } = await server.ssrLoadModule('/src/generator/review.ts');
  const { candidateAltitudeModel } = await server.ssrLoadModule('/src/generator/model.ts');
  const { validateRadioCatalog, radioFreshness } = await server.ssrLoadModule('/src/frequencies/catalog.ts');
  const readSource = async name => {
    const body = await readFile(resolve(root, 'public', name));
    return { value: JSON.parse(body), sha256: hash(body) };
  };
  const [catalog, status, radio, radioStatus] = await Promise.all([
    readSource('aip-aerodromes.json'), readSource('aip-status.json'), readSource('aip-frequencies.json'), readSource('aip-frequency-status.json'),
  ]);
  validateRadioCatalog(radio.value);
  const request = { departure: values.departure.toUpperCase(), destination: values.destination.toUpperCase(), visits: [], flightDate: values.date,
    lessonMinutes, altitudeFt, rpm: 2200, manifoldPressureInHg: 20, descentFuelFlowGph: 10, patternFuelFlowGph: 12 };
  const radioCheck = radioFreshness(radio.value, radioStatus.value, catalog.value, new Date(), request.flightDate);
  const airspace = radioCheck.usable ? radio.value : null;
  const startedAt = new Date().toISOString();
  const candidates = await generateRouteCandidates(request, catalog.value, status.value, new Date(), { airspace, progress: console.log });
  const reviews = await reviewCandidates(candidates, request, airspace, new AbortController().signal);
  const summary = reviews.map(review => ({ id: review.candidate.id, route: review.candidate.draft.waypoints.map(p => p.name),
    distanceNm: review.candidate.legs.reduce((sum, leg) => sum + leg.distanceNm, 0), blocked: candidateReviewBlocksTransfer(review),
    rasterConflicts: review.candidate.searchTerrain.conflicts, rasterMissing: review.candidate.searchTerrain.missingCorridors,
    transitConflicts: review.transitConflicts, missingHeights: review.missingHeights, failedBatches: review.terrain.failedBatches,
    surfaceOnlySamples: review.terrain.heights.filter(h => h?.surfaceOnly).length, profileIssues: review.candidate.profileIssues,
  }));
  const report = { startedAt, finishedAt: new Date().toISOString(), replay: !!values.replay, request,
    assumptions: 'POH climb defaults, no visits/wind/patterns; 2200 RPM / 20 inHg, descent 10 US gal/h. This is a diagnostic, not operational clearance.',
    sources: { aip: { effectiveDate: catalog.value.effectiveDate, checkedAt: catalog.value.checkedAt, sha256: catalog.sha256 },
      statusSha256: status.sha256, radioSha256: radio.sha256, radioStatusSha256: radioStatus.sha256, radioFreshness: radioCheck }, requests, summary,
    reviews: reviews.map(review => ({ ...review, blocksTransfer: candidateReviewBlocksTransfer(review),
      modeledLevels: review.candidate.legs.map(leg => ({ index: leg.index, from: leg.from.name, to: leg.to.name, distanceNm: leg.distanceNm,
        altitudeFrom: candidateAltitudeModel(review.candidate, request).at(leg.index, 0),
        altitudeTo: candidateAltitudeModel(review.candidate, request).at(leg.index, leg.distanceNm) })),
    })),
  };
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  console.log(`Full diagnostic: ${output}. ${values.replay ? 'Captured provider responses replayed; this is not a fresh live check.' : 'Provider responses fetched for this run.'}`);
} finally {
  globalThis.fetch = originalFetch;
  await server.close();
}
