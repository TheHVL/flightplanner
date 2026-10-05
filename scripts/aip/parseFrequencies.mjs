import { load } from 'cheerio';
import { cleanText, parseCoordinate, tableRows } from './parse.mjs';

function cleaned(html) {
  const $ = load(html);
  $('script,style,.gutter,.sdParams,.acParams,.AmdtDeletedAIRAC,.AmdtDeleted,.Deleted,.deleted,del').remove();
  $('br').replaceWith(' '); $('p,li,div').each((_, e) => $(e).append(' '));
  return $;
}
export function sectionByTitle(html, pattern) {
  const $ = cleaned(html);
  const heading = $('h3,h4,h5').get().find(e => pattern.test(cleanText($(e).text())));
  if (!heading) throw new Error(`AIP section not found: ${pattern}`);
  let next = $(heading).next(), result = '';
  while (next.length && !next.is('h3,h4,h5')) { result += $.html(next); next = next.next(); }
  return result;
}
function limit(text) {
  text = text.trim();
  if (/^GND$|^SFC$/i.test(text)) return { reference: 'GND', value: 0 };
  if (/^UNL$/i.test(text)) return { reference: 'UNL', value: null };
  const fl = text.match(/^FL\s*(\d+)$/i);
  if (fl) return { reference: 'FL', value: Number(fl[1]) * 100 };
  const feet = text.match(/^([\d ]+)\s*FT\s*(AMSL|AGL)$/i);
  if (feet) return { reference: feet[2].toUpperCase(), value: Number(feet[1].replaceAll(' ', '')) };
  throw new Error(`Unsupported published altitude limit: ${text}`);
}
export function parsePublishedVolumes(text, borderResolver) {
  const blocks = [...text.matchAll(/([\s\S]*?)Upper limit:\s*(UNL|FL\s*\d+|[\d ]+\s*FT\s*(?:AMSL|AGL))\s*Lower limit:\s*(GND|SFC|FL\s*\d+|[\d ]+\s*FT\s*(?:AMSL|AGL))(?:\s*Class:?\s*[A-G])?/gi)];
  if (!blocks.length) throw new Error('No supported published vertical limits.');
  return blocks.map(block => {
    const body = block[1];
    const matches = [...body.matchAll(/(\d{6}(?:\.\d+)?[NS])\s*(\d{7}(?:\.\d+)?[EW])/g)];
    if (matches.length < 3) throw new Error('Airspace polygon has too few published coordinates.');
    const polygon = [];
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i], p = [parseCoordinate(m[2]), parseCoordinate(m[1])];
      if (p.includes(null)) throw new Error('Invalid published airspace coordinate.');
      const prior = matches[i - 1];
      if (prior) {
        const description = body.slice(prior.index + prior[0].length, m.index).replace(/[()\-]/g, '').trim();
        if (description) {
          if (!/^(?:(?:southwards|westwards|eastwards|northwards)\s+)?along the border between (?:Norway and (?:Sweden|Russia|Finland)|Finland and Norway)(?:\s*,?\s*(?:to|then))?\s*,?$/i.test(description)) throw new Error(`Unsupported lateral boundary: ${description}`);
          if (!borderResolver) throw new Error('Country border geometry is required.');
          polygon.push(...borderResolver(polygon.at(-1), p).slice(1, -1));
        }
      }
      polygon.push(p);
    }
    if (Math.hypot(polygon[0][0] - polygon.at(-1)[0], polygon[0][1] - polygon.at(-1)[1]) > 1e-7) throw new Error('Published polygon is not explicitly closed.');
    if (polygon.length < 4) throw new Error('Polygon has too few resolved vertices.');
    const tail = body.slice(matches.at(-1).index + matches.at(-1)[0].length).replace(/[()\s\-]/g, '');
    if (tail) throw new Error(`Unresolved lateral boundary: ${tail}`);
    return { polygon, lower: limit(block[3]), upper: limit(block[2]), publishedLimits: cleanText(block[0]) };
  });
}
function channels(text) {
  return [...new Set([...text.matchAll(/\b(1[123]\d\.\d{3})\s*MHZ\b/gi)].map(m => m[1]))]
    .filter(f => f !== '121.500').map(channel => ({ channel }));
}
export function parsePolarisSectors(html, sourceUrl, borderResolver) {
  const section = sectionByTitle(html, /Polaris ACC sectorization/i);
  const rows = tableRows(null, section);
  return rows.filter(row => /^Polaris ACC (?:Sector|Oceanic Sector)/i.test(row[4] ?? '')).map(row => {
    const frequencies = channels(row[3]);
    if (frequencies.length !== 1) throw new Error(`Expected one VHF channel for ${row[4]}.`);
    return { id: row[4].replace(/[^A-Za-z0-9]+/g, '-').toLowerCase(), name: row[4], type: 'sector', unit: row[0],
      callSign: /Oceanic/.test(row[4]) ? 'Bodø Oceanic Control' : 'Polaris Control',
      channels: frequencies, remarks: row[3].replace(/1[123]\d\.\d{3}\s*MHZ\s*/i, ''), hours: 'Check ATS hours / NOTAM',
      volumes: parsePublishedVolumes(row[1], borderResolver), sourceUrl };
  });
}
export function parseTerminalAirspaces(html, sourceUrl, borderResolver) {
  const $ = cleaned(html), rows = tableRows(null, $.html());
  const spaces = [], warnings = []; let current = null;
  for (const row of rows) {
    const name = row[0]?.match(/^(.+?\s(?:TMA|TIA|TIZ|CTA))\s+(?=\d{6}[NS])/i)?.[1];
    if (name === 'Polaris CTA') { current = null; continue; }
    if (name) {
      current = { id: name.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase(), name, type: name.split(' ').at(-1), unit: row[1], callSign: row[2]?.replace(/\s+English[\s\S]*/i, '') ?? '', hours: row[2]?.split(/English/i).at(1)?.trim() ?? '', channels: [], volumes: [], sourceUrl, remarks: '' };
      const existing = spaces.find(s => s.id === current.id);
      if (existing) current = existing; else spaces.push(current);
    } else if (row[0]?.startsWith('FIR:') || /^(?:Polaris CTA|Bodø OCA|Polaris ACC Sector)/.test(row[0] ?? '')) current = null;
    if (!current) continue;
    const freqColumn = row.length === 5 ? row[3] : '';
    const remarks = row.length === 5 ? row[4] : '';
    for (const freq of channels(freqColumn)) {
      if (!current.channels.some(f => f.channel === freq.channel && f.remarks === remarks)) current.channels.push({ ...freq, callSign: row[2]?.replace(/\s+English[\s\S]*/i, '') || current.callSign, remarks });
    }
    if (remarks && !current.remarks.includes(remarks)) current.remarks += `${current.remarks ? ' ' : ''}${remarks}`;
    if (row[0]?.includes('Upper limit:')) {
      try { for (const volume of parsePublishedVolumes(row[0], borderResolver)) if (!current.volumes.some(v => JSON.stringify(v) === JSON.stringify(volume))) current.volumes.push(volume); }
      catch (error) { current.unresolvedGeometry = true; warnings.push(`${current.name}: ${error.message}`); }
    }
  }
  return { spaces: spaces.filter(s => s.channels.length && s.volumes.length), warnings };
}
export function parseAerodromeRadioArea(ad, description, borderResolver) {
  const name = description.lateralLimits.match(/^(.+?\s(?:CTR|TIZ|ATZ))\b/i)?.[1];
  if (!name) return null;
  const limits = description.verticalLimits.match(/^(GND|SFC|[\d ]+\s*FT\s*(?:AMSL|AGL)|FL\s*\d+)\s+to\s+(UNL|[\d ]+\s*FT\s*(?:AMSL|AGL)|FL\s*\d+)/i);
  if (!limits) throw new Error(`Unsupported aerodrome vertical limits: ${description.verticalLimits}`);
  const frequencies = (ad.frequencies ?? []).filter(f => /^(?:TWR|AFIS|INFO)/i.test(f.service) && f.frequencyMHz !== '121.500')
    .map(f => ({ channel: f.frequencyMHz, callSign: f.callSign, remarks: `${f.hours}${f.remarks && f.remarks !== 'NIL' ? ': ' + f.remarks : ''}` }));
  if (!frequencies.length) return null;
  return { id: `${ad.icao}-radio-area`, name, type: name.split(' ').at(-1), unit: ad.icao, callSign: description.callSign,
    channels: frequencies, volumes: parsePublishedVolumes(`${description.lateralLimits} Upper limit: ${limits[2]} Lower limit: ${limits[1]}`, borderResolver),
    hours: description.hours, remarks: description.remarks, sourceUrl: ad.sourceUrl };
}
