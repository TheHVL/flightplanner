// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AipPanel } from '../src/components/AipPanel';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
const catalog = {
  effectiveDate:'2026-09-03',source:'Avinor AIP Norway',generatedAt:'2026-10-05',issueUrl:'https://aim-prod.avinor.no/aip',
  aerodromes:[{icao:'ENDU',name:'BARDUFOSS',elevationFt:254,lat:69.055833,lon:18.540278,sourceUrl:'https://aim-prod.avinor.no/aip',runways:[{designator:'10',trueBearingDeg:103,lengthM:2443,widthM:45,surface:'ASPH'}],frequencies:[{service:'TWR',callSign:'Bardufoss Tower',frequencyMHz:'118.105',hours:'HO',remarks:'NIL'}]}],
  reportingPoints:[{id:'ENDU:FINNSNES',name:'FINNSNES',aerodromeIcao:'ENDU',lat:69.240278,lon:17.965,sourceUrl:'https://aim-prod.avinor.no/aip'},{id:'ENDU:SØRREISA',name:'SØRREISA',aerodromeIcao:'ENDU',lat:69.126389,lon:18.195833,sourceUrl:'https://aim-prod.avinor.no/aip'}],
  vfrRoutes:[{id:'ENDU:1',name:'Western sector',aerodromeIcao:'ENDU',pointIds:['ENDU:FINNSNES','ENDU:SØRREISA'],sourceUrl:'https://aim-prod.avinor.no/aip',remarks:'Reviewed fixture'}],
};

afterEach(()=>vi.unstubAllGlobals());
describe('AIP browser',()=>{
  it('groups every point by airport without truncation and searches airport names as well as points', async () => {
    const grouped = {
      ...catalog,
      aerodromes: [{...catalog.aerodromes[0], icao:'ENTC', name:'TROMSØ / Langnes'}, ...catalog.aerodromes],
      reportingPoints: [
        ...catalog.reportingPoints,
        ...Array.from({length:35}, (_, index) => ({...catalog.reportingPoints[0], id:`ENTC:${index}`, name:index === 0 ? 'FINNSNES' : `POINT ${String(index).padStart(2,'0')}`, aerodromeIcao:'ENTC'})),
      ],
    };
    vi.stubGlobal('fetch', vi.fn(async(input:RequestInfo | URL) => ({ok:true,json:async() => String(input).includes('aip-status.json') ? {state:'success',attemptedAt:new Date().toISOString(),effectiveDate:grouped.effectiveDate} : grouped})));
    const store = new FlightPlanStore();
    const element = document.createElement('section'); document.body.replaceChildren(element);
    new AipPanel(element, store);
    await vi.waitFor(() => expect(element.querySelectorAll('[data-aip-group]')).toHaveLength(2));
    expect(Array.from(element.querySelectorAll<HTMLElement>('[data-aip-group]')).map(group => group.dataset.aipGroup)).toEqual(['ENDU','ENTC']);
    expect(element.querySelectorAll('[data-aip-group="ENTC"] [data-aip-add-point]')).toHaveLength(35);
    expect(element.querySelector<HTMLDetailsElement>('[data-aip-group="ENDU"]')!.open).toBe(false);
    const search = element.querySelector<HTMLInputElement>('[data-aip-search]')!;
    const find = (value:string) => { search.value=value; search.dispatchEvent(new Event('input')); };
    find('Tromsø');
    expect(element.querySelectorAll('[data-aip-group]')).toHaveLength(1);
    expect(element.querySelector<HTMLDetailsElement>('[data-aip-group="ENTC"]')!.open).toBe(true);
    expect(element.querySelectorAll('[data-aip-add-point]')).toHaveLength(35);
    find('FINNSNES');
    expect(element.querySelectorAll('[data-aip-group]')).toHaveLength(2);
    expect(element.querySelectorAll('[data-aip-add-point]')).toHaveLength(2);
    element.querySelector<HTMLButtonElement>('[data-aip-add-point="ENTC:0"]')!.click();
    expect(store.getWaypoints()[0].aipId).toBe('ENTC:0');
    find('no matching point');
    expect(element.querySelector('[data-aip-results]')!.textContent).toContain('No airports or reporting points');
  });
  it('keeps the manual planner focused on airports and individual points and warns about older saved point data',async()=>{
    vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo | URL)=>({ok:true,json:async()=>String(input).includes('aip-status.json')?{state:'success',attemptedAt:new Date().toISOString(),effectiveDate:catalog.effectiveDate}:catalog})));
    const store=new FlightPlanStore();
    const element=document.createElement('section');document.body.replaceChildren(element);
    new AipPanel(element,store);
    await vi.waitFor(()=>expect(element.querySelector('[data-aip-status]')!.textContent).toContain('1 aerodromes'));
    const search=element.querySelector<HTMLInputElement>('[data-aip-search]')!;
    search.value='endu';search.dispatchEvent(new Event('input'));
    element.querySelector<HTMLButtonElement>('[data-aip-ad="ENDU"]')!.click();
    expect(element.querySelector('[data-aip-details]')!.textContent).toContain('TWR 118.105');
    expect(element.querySelector('[data-aip-details]')!.textContent).toContain('RWY 10');
    element.querySelector<HTMLButtonElement>('[data-aip-add-ad="ENDU"]')!.click();
    expect(element.querySelector('[data-aip-route]')).toBeNull();
    element.querySelector<HTMLButtonElement>('[data-aip-choose-point="ENDU:FINNSNES"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-aip-choose-point="ENDU:SØRREISA"]')!.click();
    element.querySelector<HTMLButtonElement>('[data-aip-append-sequence]')!.click();
    expect(store.getWaypoints().map(point=>point.name)).toEqual(['ENDU','FINNSNES','SØRREISA']);
    expect(store.getVerticalProfileSettings().departureElevationFt).toBe(254);
    store.appendAipWaypoints([{name:'Old point',lat:69,lon:18,aipId:'OLD',aipEffectiveDate:'2026-06-11'}]);
    expect(element.querySelector('[data-aip-plan-status]')!.textContent).toContain('older AIP');
  });
});
