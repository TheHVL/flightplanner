import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePolarisSectors, parseAerodromeRadioArea, parsePublishedVolumes, parseTerminalAirspaces } from '../scripts/aip/parseFrequencies.mjs';
import { parseAerodromeAirspaceDescription } from '../scripts/aip/parse.mjs';
const fixture=name=>readFileSync(new URL(`./fixtures/aip/${name}`,import.meta.url),'utf8');
const sourceUrl='https://aim-prod.avinor.no/no/AIP/';
describe('published ATS importer',()=>{
  it('reads lower and upper Polaris L8/U8 channels and exact vertical division from the current AIP excerpt',()=>{
    const areas=parsePolarisSectors(fixture('polaris-sectors.html'),sourceUrl);
    expect(areas.map(a=>a.channels[0].channel)).toEqual(['134.355','127.380']);
    expect(areas[0].volumes[0].lower).toEqual({reference:'GND',value:0});
    expect(areas[0].volumes[0].upper).toEqual({reference:'FL',value:36500});
    expect(areas[1].volumes[0].lower).toEqual({reference:'FL',value:36500});
    expect(areas[1].volumes[0].upper).toEqual({reference:'UNL',value:null});
  });
  it('reads Bardufoss CTR geometry and excludes emergency and approach channels from the local tower area',()=>{
    const description=parseAerodromeAirspaceDescription('ENDU',fixture('endu-airspace.html'));
    const area=parseAerodromeRadioArea({icao:'ENDU',sourceUrl,frequencies:[{service:'TWR',frequencyMHz:'118.105',callSign:'Bardufoss Tower',hours:'Check AIP',remarks:'NIL'},{service:'APP',frequencyMHz:'118.805'},{service:'TWR',frequencyMHz:'121.500'}]},description);
    expect(area.type).toBe('CTR');expect(area.channels.map(c=>c.channel)).toEqual(['118.105']);
    expect(area.volumes[0].polygon).toHaveLength(5);expect(area.volumes[0].upper.value).toBe(4500);
  });
  it('requires exact handling of country-border edges and refuses unsupported arcs',()=>{
    const body='690000N 0180000E - 691000N 0190000E - along the border between Norway and Sweden to 692000N 0200000E - (690000N 0180000E) Upper limit: FL 195 Lower limit: GND';
    expect(()=>parsePublishedVolumes(body)).toThrow('border geometry');
    const v=parsePublishedVolumes(body,(a,b)=>[a,[19.5,69.1],b])[0];expect(v.polygon).toContainEqual([19.5,69.1]);
    expect(()=>parsePublishedVolumes(body.replace('along the border between Norway and Sweden to','along an arc clockwise to'),()=>[])).toThrow('Unsupported lateral');
  });
  it('retains channel rowspans without duplicating published volumes',()=>{
    const geometry='TEST TMA 690000N 0180000E - 691000N 0190000E - 692000N 0180000E - (690000N 0180000E) Upper limit: FL 195 Lower limit: 3500 FT AMSL';
    const html=`<table><tr><td rowspan="2">${geometry}</td><td rowspan="2">Test ATS</td><td rowspan="2">Test Approach English H24</td><td>123.755 MHZ</td><td>NIL</td></tr><tr><td>118.805 MHZ</td><td>NIL</td></tr></table>`;
    const parsed=parseTerminalAirspaces(html,sourceUrl);expect(parsed.warnings).toEqual([]);
    expect(parsed.spaces[0].volumes).toHaveLength(1);expect(parsed.spaces[0].channels).toHaveLength(2);
  });
});
