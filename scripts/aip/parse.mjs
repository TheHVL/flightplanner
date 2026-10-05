import { load } from 'cheerio';

export function cleanText(value) {
  return value.replace(/T[A-Z0-9_]+;[A-Z0-9_]+;\d+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseCoordinate(value) {
  const match = value.match(/^(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)([NSEW])$/i);
  if (!match) return null;
  const [, d, m, s, hemisphere] = match;
  const decimal = Number(d) + Number(m) / 60 + Number(s) / 3600;
  if (Number(m) >= 60 || Number(s) >= 60 || decimal > (/[NS]/i.test(hemisphere) ? 90 : 180)) return null;
  return /[SW]/i.test(hemisphere) ? -decimal : decimal;
}
export function resolveIssue(html, historyUrl, today = new Date().toISOString().slice(0, 10)) {
  const $ = load(html);
  const issues = [];
  $('a[href]').each((_, link) => {
    const href = $(link).attr('href');
    const date = href.match(/(\d{4}-\d{2}-\d{2})-AIRAC/i)?.[1];
    if (!date) return;
    const url = new URL(href, historyUrl);
    if (url.hostname !== 'aim-prod.avinor.no') return;
    const root = new URL('./', url);
    const row = cleanText($(link).closest('tr').text());
    const dates = [...row.matchAll(/\b(\d{2})\s+(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\s+(\d{4})\b/gi)].map(m => `${m[3]}-${String(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(m[2].toUpperCase()) + 1).padStart(2, '0')}-${m[1]}`);
    issues.push({ effectiveDate: date, issueRoot: root.toString(), issueUrl: new URL('index-en-GB.html', root).toString(), publicationDate: dates[1] ?? null });
  });
  const current = issues.filter(issue => issue.effectiveDate <= today).sort((a,b) => b.effectiveDate.localeCompare(a.effectiveDate))[0];
  if (!current) throw new Error('No currently effective Avinor AIP edition found.');
  return { ...current, nextEffectiveDate: issues.filter(issue => issue.effectiveDate > today).map(issue => issue.effectiveDate).sort()[0] ?? null };
}

export function discoverAerodromePages(html, sourceUrl) {
  const $ = load(html);
  const pages = new Map();
  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const match = href.match(/EN-AD-2\.(EN[A-Z]{2})-en-GB\.html/i);
    if (match) pages.set(match[1].toUpperCase(), new URL(href, sourceUrl).toString());
  });
  return pages;
}

// Expand eAIP rowspans so reciprocal runway rows and repeated services retain
// their published cells. Parse only the section/table appropriate to each field.
export function tableRows($, html) {
  const fragment = load(html);
  fragment('.sdParams,.AmdtDeletedAIRAC,.AmdtDeleted,.Deleted,.deleted,del').remove();
  fragment('br').replaceWith(' ');
  fragment('p,li,div').each((_, element) => fragment(element).append(' '));
  const rows = [];
  const spans = new Map();
  fragment('tr').each((_, tr) => {
    const row = [];
    let column = 0;
    const fill = () => {
      while (spans.has(column)) {
        const span = spans.get(column);
        row[column++] = span.text;
        if (--span.remaining === 0) spans.delete(column - 1);
      }
    };
    fill();
    fragment(tr).children('td,th').each((_, td) => {
      fill();
      const cell = fragment(td);
      const text = cleanText(cell.text());
      const columns = Number(cell.attr('colspan') ?? 1);
      const count = Number(cell.attr('rowspan') ?? 1);
      for (let n = 0; n < columns; n++) {
        row[column] = text;
        if (count > 1) spans.set(column, { text, remaining: count - 1 });
        column++;
      }
    });
    fill();
    rows.push(row);
  });
  return rows;
}
function sectionHtml($, icao, number) {
  let start = null;
  $('h3,h4,h5').each((_, el) => {
    if (new RegExp(`\\b${icao}\\s+AD\\s+2\\.${number}(?:\\s|$)`).test(cleanText($(el).text()))) start = el;
  });
  if (!start) return '';
  let result = '';
  let next = $(start).next();
  while (next.length && !next.is('h3,h4,h5')) { result += $.html(next); next = next.next(); }
  return result;
}
const number = value => {
  const match = value?.match(/^\s*(\d[\d ]*(?:\.\d+)?)/);
  return match ? Number(match[1].replaceAll(' ', '')) : null;
};

export function parseAerodromeAirspaceDescription(icao, html) {
  const $ = load(html);
  const rows = tableRows($, sectionHtml($, icao, 17));
  const value = label => rows.find(row => row[1]?.toUpperCase().includes(label))?.slice(2).join(' ') ?? '';
  return { lateralLimits: value('DESIGNATION AND LATERAL'), verticalLimits: value('VERTICAL LIMITS'),
    airspaceClass: value('AIRSPACE CLASSIFICATION'), callSign: value('ATS UNIT CALL SIGN').replace(/\s+English[\s\S]*/i, ''),
    hours: value('HOURS OF APPLICABILITY'), remarks: value('RMK') };
}

export function parseAerodromePage(icao, html, sourceUrl) {
  const $ = load(html);
  // These hidden AIXM annotations are present in Avinor eAIP and are not data.
  $('script,style,.gutter,.sdParams,.acParams,.AmdtDeletedAIRAC,.AmdtDeleted,.Deleted,.deleted,del').remove();
  $('br').replaceWith(' ');
  $('p,li').each((_, element) => $(element).append(' '));
  const basic = tableRows($, sectionHtml($, icao, 2));
  const value = label => basic.find(row => row[1]?.toUpperCase().includes(label))?.slice(2).join(' ') ?? '';
  const elevationFt = number(value('ELEV/REF TEMP'));
  const coords = value('ARP COORDINATES').match(/(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW])/);
  if (elevationFt === null || !coords) throw new Error(`${icao}: missing elevation or ARP coordinates`);
  const name = cleanText($('h3').first().text()).replace(new RegExp(`^${icao}\\s*[—–-]\\s*`), '').trim();
  const runwayRows = tableRows($, sectionHtml($, icao, 12));
  const distances = tableRows($, sectionHtml($, icao, 13));
  const runways = runwayRows.filter(row => /^\d{2}[LRC]?$/.test(row[0]) && /°/.test(row[1] ?? '')).map(row => {
    const dimensions = row[2]?.match(/([\d ]+)\s*[x×]\s*([\d.]+)/i);
    const declared = distances.find(candidate => candidate[0] === row[0] && candidate.length === 6);
    return { designator: row[0], trueBearingDeg: number(row[1]), lengthM: dimensions ? Number(dimensions[1].replaceAll(' ', '')) : null, widthM: dimensions ? Number(dimensions[2]) : null,
      surface: row[3] ?? '', toraM: number(declared?.[1]), asdaM: number(declared?.[2]), todaM: number(declared?.[3]), ldaM: number(declared?.[4]), remarks: declared?.[5] ?? '' };
  });
  let service = '', callSign = '';
  const frequencies = tableRows($, sectionHtml($, icao, 18)).flatMap(row => {
    const match = row[2]?.match(/\b(1[123]\d\.\d{3})\s*MHZ\b/i);
    if (!match) return [];
    if (row[0]) service = row[0];
    if (row[1]) callSign = row[1];
    return [{ service, callSign, frequencyMHz: match[1], hours: row[3] ?? '', remarks: row[4] ?? '' }];
  });
  const airspace = tableRows($, sectionHtml($, icao, 17));
  const transitionAltitudeFt = number(airspace.find(row => row[1]?.toLowerCase().includes('transition altitude'))?.[2]);
  const charts = [];
  const chartSection = load(sectionHtml($, icao, 24));
  chartSection('tr').each((_, tr) => {
    const title = cleanText(chartSection(tr).children('td').first().text());
    if (!/VFR|visual approach/i.test(title)) return;
    chartSection(tr).find('a[href]').each((_, link) => {
      const url = new URL(chartSection(link).attr('href'), sourceUrl);
      if (url.hostname === 'aim-prod.avinor.no' && /\.pdf$/i.test(url.pathname) && !charts.some(chart => chart.sourceUrl === url.toString())) charts.push({ title, sourceUrl: url.toString() });
    });
  });
  const text = section => cleanText(load(sectionHtml($, icao, section)).text());
  return { icao, name: name || icao, elevationFt, lat: parseCoordinate(coords[1]), lon: parseCoordinate(coords[2]), sourceUrl, runways, frequencies, transitionAltitudeFt, atsAirspace: parseAerodromeAirspaceDescription(icao, html),
    localRegulations: text(20), circuitNotes: text(21), flightProcedures: text(22), charts };
}

export function parseReportingPoints(icao, text, sourceUrl) {
  const points = new Map();
  // Coordinates must be a published NAME/LAT/LON table row, never inferred
  // from map labels, bearings, or chart geometry.
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-ZÆØÅÉ0-9][A-ZÆØÅÉ0-9 /().-]{1,55}?)\s+(\d{6}(?:\.\d+)?[NS])\s+(\d{7}(?:\.\d+)?[EW])\s*$/i);
    if (!match) continue;
    const name = match[1].trim();
    const lat = parseCoordinate(match[2]), lon = parseCoordinate(match[3]);
    if (lat === null || lon === null) continue;
    const id = `${icao}:${name.toUpperCase()}`;
    const previous = points.get(id);
    if (previous && (previous.lat !== lat || previous.lon !== lon)) throw new Error(`Conflicting coordinates for ${id}`);
    points.set(id, { id, name, aerodromeIcao: icao, lat, lon, sourceUrl });
  }
  return [...points.values()];
}

export function verifiedRoutes(definitions, charts, points) {
  // Graphical chart routes require reviewed point order and a source checksum.
  // A changed publication disables the old sequence until reviewed again.
  return definitions.flatMap(definition => {
    const chart = charts.find(chart => chart.sha256 === definition.chartSha256 && chart.aerodromeIcao === definition.aerodromeIcao);
    if (!chart) return [];
    const pointIds = definition.pointNames.map(name => `${definition.aerodromeIcao}:${name.toUpperCase()}`);
    if (pointIds.length < 2 || pointIds.some(id => !points.some(point => point.id === id))) return [];
    return [{ id: definition.id, name: definition.name, aerodromeIcao: definition.aerodromeIcao, pointIds, sourceUrl: chart.sourceUrl, remarks: definition.remarks ?? '' }];
  });
}

/** Read the actual coordinate-table alignment, independent of PDF reading order. */
export function parseReportingPointBbox(icao, bboxHtml, sourceUrl) {
  const $ = load(bboxHtml, { xmlMode: true });
  const points = [];
  $('page').each((_, page) => {
    const words = $(page).find('word').toArray().map(el => ({ text: $(el).text(), x: Number($(el).attr('xMin')), right: Number($(el).attr('xMax')), y: Number($(el).attr('yMin')) }));
    for (const latitude of words.filter(word => /^\d{6}(?:\.\d+)?[NS]$/.test(word.text))) {
      const aligned = words.filter(word => Math.abs(word.y - latitude.y) < 2);
      const longitude = aligned.filter(word => /^\d{7}(?:\.\d+)?[EW]$/.test(word.text) && word.x > latitude.right && word.x - latitude.right < 80).sort((a,b) => a.x - b.x)[0];
      if (!longitude) continue;
      const left = aligned.filter(word => word.right < latitude.x && latitude.x - word.right < 130 && /^[A-ZÆØÅÉ][A-ZÆØÅÉ0-9/().-]*$/.test(word.text)).sort((a,b) => b.right - a.right);
      const nameParts = [];
      let lastX = latitude.x;
      for (const word of left) {
        if (lastX - word.right > (nameParts.length ? 15 : 70) || !/^[A-ZÆØÅÉ0-9][A-ZÆØÅÉ0-9/().-]*$/.test(word.text)) break;
        nameParts.unshift(word.text);
        lastX = word.x;
      }
      const name = nameParts.join(' ');
      if (name.length < 2 || /^(ARP|THR|RWY|AD|LAT|LATITUDE)$/.test(name)) continue;
      const lat = parseCoordinate(latitude.text), lon = parseCoordinate(longitude.text);
      if (lat === null || lon === null) continue;
      const id = `${icao}:${name}`;
      const previous = points.find(point => point.id === id);
      if (previous && (previous.lat !== lat || previous.lon !== lon)) throw new Error(`Conflicting coordinates for ${id}`);
      if (!previous) points.push({ id, name, aerodromeIcao: icao, lat, lon, sourceUrl });
    }
  });
  return points;
}

export function annotateReportingPoints(points, chartTitle, chartText) {
  const helOnly = chartText.match(/SIG\s+POINTS\s+(.{1,100}?)\s+HEL\s+ONLY/i)?.[1] ?? '';
  return points.map(point => ({ ...point,
    remarks: helOnly.toUpperCase().includes(point.name.toUpperCase()) ? 'Helicopter only, as stated on the published chart.' : /helicopter/i.test(chartTitle) ? 'Published on a helicopter chart; check applicability.' : '',
  }));
}
