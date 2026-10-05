// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { FrequencyPlanner } from '../src/frequencies/FrequencyPlanner';
import { FrequencyPanel } from '../src/components/FrequencyPanel';
import { validateRadioCatalog, type RadioCatalog } from '../src/frequencies/catalog';
const read=(name:string)=>JSON.parse(readFileSync(`${process.cwd()}/public/${name}`,'utf8'));
let data:RadioCatalog;
beforeEach(()=>{
  localStorage.clear();vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-05T22:00:00Z'));
  data=JSON.parse(readFileSync(`${process.cwd()}/tests/fixtures/aip/northern-radio-areas.json`,'utf8'));data.effectiveDate='2026-09-03';data.nextEffectiveDate=null;data.checkedAt=new Date().toISOString();
  vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{
    const url=String(input);let result;
    if(url.includes('aip-frequencies.json'))result=data;
    else if(url.includes('aip-frequency-status.json'))result={state:'success',effectiveDate:data.effectiveDate,attemptedAt:data.checkedAt};
    else result={...read('aip-aerodromes.json'),effectiveDate:data.effectiveDate};
    return new Response(JSON.stringify(result),{status:200});
  }));
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});
describe('frequency planning integration',()=>{
  it('validates the shipped snapshot and connects current airport channels to route suggestions',async()=>{
    expect(()=>validateRadioCatalog(read('aip-frequencies.json'))).not.toThrow();
    expect(()=>validateRadioCatalog(data)).not.toThrow();
    const store=new FlightPlanStore();const planner=new FrequencyPlanner(store);
    const a=store.addWaypoint({lat:69.05576,lon:18.54036},'ENDU'),b=store.addWaypoint({lat:69.68333,lon:18.91892},'ENTC');
    store.setPlannedAltitudeFt(a.id,b.id,2500);await planner.reload();
    const plan=planner.getPlans()[0];expect(plan.note).toBeUndefined();
    expect(plan.segments[0].primary.map(c=>c.channel)).toContain('118.105');
    expect(plan.segments.at(-1)?.primary.map(c=>c.channel)).toContain('118.305');
    expect(plan.airports.map(c=>c.airport.icao)).toEqual(['ENDU','ENTC']);
    const element=document.createElement('section');new FrequencyPanel(element,store,planner);
    expect(element.textContent).toContain('Route frequencies');expect(element.querySelector('a[href*="ENR-2.1"]')).not.toBeNull();
    store.setManualFrequency(a.id,b.id,'126.455');
    expect(element.textContent).toContain('Manual OFP entry: 126.455');
    element.querySelector<HTMLButtonElement>('[data-frequency-auto]')!.click();
    expect(store.getManualFrequency(a.id,b.id)).toBeNull();
  });
  it('invalidates cached plans when a route is bent and withholds automatic entries when an open tab ages',async()=>{
    const store=new FlightPlanStore();const planner=new FrequencyPlanner(store);const shapes=new RouteShapeController(store);
    const a=store.addWaypoint({lat:69,lon:18},'A'),b=store.addWaypoint({lat:69.7,lon:19},'B');store.setPlannedAltitudeFt(a.id,b.id,4500);
    await planner.reload();const before=planner.getPlans();
    shapes.setLegShape(0,{lat:69.2,lon:17.5});const after=planner.getPlans();
    expect(after).not.toBe(before);expect(after[0].leg.distanceNm).toBeGreaterThan(before[0].leg.distanceNm);
    store.setManualFrequency(a.id,b.id,'126.455');vi.setSystemTime(new Date('2026-10-08T22:00:00Z'));
    expect(planner.getPlans()[0]).toMatchObject({manual:'126.455',segments:[]});
    expect(planner.getStatus()).toContain('withheld');
  });
});
