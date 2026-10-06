import { describe, expect, it } from 'vitest';
import { calculateRouteLegs, routeLegKey } from '../src/navigation/geodesy';
import { planLegFrequencies } from '../src/frequencies/routeFrequencies';
import { radioFreshness, validateRadioCatalog, type RadioArea, type RadioCatalog } from '../src/frequencies/catalog';
import type { AipAerodromeCatalog } from '../src/aip/aerodromes';
const url = 'https://aim-prod.avinor.no/no/AIP/';
const area = (id: string, channel: string, x: number, X: number, type = 'sector', floor = 0, ceiling = 50000): RadioArea => ({
  id, name: id, type, unit: id, callSign: id, hours: 'H24', remarks: '', sourceUrl: url, channels: [{ channel }],
  volumes: [{ polygon: [[x,-1],[X,-1],[X,1],[x,1],[x,-1]], lower: { reference: 'AMSL', value: floor }, upper: { reference: 'AMSL', value: ceiling }, publishedLimits: 'Test limits' }],
});
const catalog = (airspaces: RadioArea[]): RadioCatalog => ({ schemaVersion: 1, source: 'Avinor', effectiveDate: '2026-09-03', checkedAt: '2026-10-05T10:00:00Z', generatedAt: '2026-10-05T10:00:00Z', issueUrl: url, nextEffectiveDate: null, airspaces, coverageWarnings: [], boundarySource: { source: 'Kartverket', sourceUrl: 'https://www.kartverket.no/api-og-data/grensedata', license: 'CC BY 4.0', simplificationMeters: 20 } });
const a = { id:'a', name:'A', lat:0, lon:0 }, b = { id:'b', name:'B', lat:0, lon:2 };
const leg = calculateRouteLegs([a,b])[0];
describe('route frequencies', () => {
  it('splits one leg at sector boundaries and preserves a narrow area smaller than the sampling chord', () => {
    const data = catalog([area('west','126.455',-1,1),area('east','126.705',1,3),area('thin','123.755',1.001,1.003,'TMA')]);
    const sequence = planLegFrequencies(leg,data,()=>4500);
    expect(sequence.map(s=>s.primary[0]?.channel)).toEqual(['126.455','126.705','123.755','126.705']);
    expect(sequence[0].endNm).toBeCloseTo(leg.distanceNm/2,2);
    expect(sequence[2].endNm-sequence[2].startNm).toBeLessThan(0.2);
    expect(sequence.at(-1)?.endNm).toBe(leg.distanceNm);
  });
  it('matches the flown bend rather than the direct waypoint line', () => {
    const inside = area('bend','123.755',0.9,1.1,'TMA');
    inside.volumes[0].polygon = [[0.9,0.8],[1.1,0.8],[1.1,1.2],[0.9,1.2],[0.9,0.8]];
    const data = catalog([area('base','126.455',-1,3),inside]);
    expect(planLegFrequencies(leg,data,()=>4500).some(s=>s.primary[0]?.channel==='123.755')).toBe(false);
    const shaped = calculateRouteLegs([a,b],new Map([[routeLegKey(a.id,b.id),{lat:1,lon:1}]]))[0];
    expect(planLegFrequencies(shaped,data,()=>4500).some(s=>s.primary[0]?.channel==='123.755')).toBe(true);
  });
  it('uses climb altitude crossings and gives local CTR services precedence', () => {
    const low = area('lower','134.355',-1,3,'sector',0,36500), high = area('upper','127.380',-1,3,'sector',36500);
    low.volumes[0].upper.reference='FL'; high.volumes[0].lower.reference='FL';
    const sequence=planLegFrequencies(leg,catalog([low,high]),d=>35000+3000*d/leg.distanceNm);
    expect(sequence.map(s=>s.primary[0]?.channel).filter((v,i,x)=>i===0||v!==x[i-1])).toEqual(['134.355','127.380']);
    const data=catalog([area('Polaris','126.455',-1,3),area('TMA','123.755',-1,3,'TMA',3500),area('CTR','118.305',-1,3,'CTR',0,4500)]);
    expect(planLegFrequencies(leg,data,()=>4000)[0].primary[0].channel).toBe('118.305');
    const overlying=planLegFrequencies(leg,catalog(data.airspaces.slice(0,2)),()=>2500)[0];
    expect(overlying.primary[0]).toMatchObject({channel:'123.755',role:'overlying'});
    expect(overlying.alternatives[0].channel).toBe('126.455');
  });
  it('retains ambiguous channels and withholds suggestions for missing levels or unresolved local geometry', () => {
    const tma=area('TMA','123.755',-1,3,'TMA'); tma.channels.push({channel:'118.805'});
    const data=catalog([tma]);
    expect(planLegFrequencies(leg,data,()=>4500)[0].primary).toHaveLength(2);
    expect(planLegFrequencies(leg,data,()=>4500)[0].note).toContain('Multiple published');
    expect(planLegFrequencies(leg,data,()=>null)[0].primary).toEqual([]);
    data.withheldAreas=[{name:'Unresolved CTR',bounds:[0.5,-0.1,1.5,0.1],sourceUrl:url}];
    expect(planLegFrequencies(leg,data,()=>4500).map(s=>s.primary.length)).toEqual([2,0,2]);
  });
});
describe('frequency source validation and freshness', () => {
  const data=catalog([area('Polaris','126.455',-1,3)]);
  const airports={effectiveDate:data.effectiveDate,checkedAt:data.checkedAt,nextEffectiveDate:null} as AipAerodromeCatalog;
  const status={state:'success' as const,attemptedAt:data.checkedAt,effectiveDate:data.effectiveDate};
  const now=new Date('2026-10-05T12:00:00Z');
  it('uses a recently verified snapshot after a failed refresh, but rejects stale geometry and edition mismatches',()=>{
    expect(radioFreshness(data,status,airports,now).usable).toBe(true);
    const fallback = radioFreshness(data,{...status,state:'failed'},airports,now);
    expect(fallback.usable).toBe(true);
    expect(fallback.warning).toBe(true);
    expect(fallback.message).toContain('last successful snapshot');
    expect(radioFreshness({...data,checkedAt:'2026-10-01T10:00:00Z'},{...status,state:'failed'},airports,now).usable).toBe(false);
    expect(radioFreshness(data,null,airports,now).usable).toBe(false);
    expect(radioFreshness(data,{...status,state:'failed',effectiveDate:'2026-08-06'},airports,now).usable).toBe(false);
    expect(radioFreshness({...data,checkedAt:'2026-10-01T10:00:00Z'},status,airports,now).usable).toBe(false);
    expect(radioFreshness(data,status,{...airports,effectiveDate:'2026-10-29'},now).usable).toBe(false);
    expect(radioFreshness({...data,nextEffectiveDate:'2026-10-29'},status,airports,now,'2026-10-30T10:00').usable).toBe(false);
  });
  it('rejects emergency channels, invalid polygons and untrusted source URLs',()=>{
    expect(()=>validateRadioCatalog(data)).not.toThrow();
    for(const mutate of [(d:RadioCatalog)=>{d.airspaces[0].channels[0].channel='121.500';},(d:RadioCatalog)=>{d.airspaces[0].volumes[0].polygon.pop();},(d:RadioCatalog)=>{d.airspaces[0].sourceUrl='https://example.com';}]) {
      const invalid=structuredClone(data);mutate(invalid);expect(()=>validateRadioCatalog(invalid)).toThrow();
    }
  });
});
