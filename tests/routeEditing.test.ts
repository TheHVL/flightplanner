// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { RoutePanel } from '../src/components/RoutePanel';
import { OFPTable } from '../src/components/OFPTable';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { greatCircleDistanceNm } from '../src/navigation/geodesy';
import { airportRouteSectors } from '../src/map/routeSectors';
import { identifyTestAirport } from './helpers/airports';

beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });

it.each([
  {first:5.7, second:7.2, displayed:['6','7'], total:'13'},
  {first:5.2, second:7.2, displayed:['5','7'], total:'12'},
])('adds displayed whole-NM legs ($first + $second) without rounding calculation inputs', ({first,second,displayed,total}) => {
  const store = new FlightPlanStore();
  const nmPerDegree = greatCircleDistanceNm({lat:0,lon:0},{lat:1,lon:0});
  store.addWaypoint({lat:0,lon:0},'A');
  store.addWaypoint({lat:first/nmPerDegree,lon:0},'B');
  store.addWaypoint({lat:(first+second)/nmPerDegree,lon:0},'C');
  store.updatePerformanceSettings({usePohPerformance:false});
  store.updateVerticalProfileSettings({departureElevationFt:2500,destinationElevationFt:2500});
  saveFuelPlanningSettings({...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph:12});
  const before = calculateFuelPlanForStore(store);
  const element = document.createElement('section');
  new OFPTable(element,store).render();
  const rows = element.querySelectorAll<HTMLTableRowElement>('tbody tr[data-leg-from]');
  expect([...rows].map(row=>row.cells[17].textContent)).toEqual(displayed);
  expect([...rows].map(row=>row.cells[7].textContent)).toEqual([displayed[0],total]);
  expect(element.querySelector('.route-total strong')?.textContent).toBe(`${total} NM`);
  expect(rows[1].cells[7].title).toContain(`${(first+second).toFixed(2)} NM`);
  expect(store.getLegs()[0].distanceNm).toBeCloseTo(first,8);
  expect(store.getLegs()[1].distanceNm).toBeCloseTo(second,8);
  expect(calculateFuelPlanForStore(store)).toEqual(before);
});

it('moves a waypoint across several positions in one undo, keeping unaffected leg inputs and bends', () => {
  const store = new FlightPlanStore(2500), shapes = new RouteShapeController(store);
  const [a,b,c,d] = ['A','B','C','D','E'].map((name,i)=>store.addWaypoint({lat:69+i*.1,lon:18+i*.2},name));
  store.setPlannedAltitudeFt(b.id,c.id,null);
  store.setManualLegWind(b.id,c.id,{windFromDeg:230,windSpeedKt:12});
  store.setManualMsaFt(a.id,b.id,1800);
  shapes.setLegShape(1,{lat:69.1,lon:18.7});
  shapes.setLegShape(0,{lat:69.1,lon:18.1});
  const before = store.exportWorkingDraftState(), bends = shapes.getShapeDraft();
  store.moveWaypointToIndex(a.id,3);
  expect(store.getWaypoints().map(p=>p.name)).toEqual(['B','C','D','A','E']);
  expect(store.getPlannedAltitudeFt(b.id,c.id)).toBeNull();
  expect(store.getManualLegWind(b.id,c.id)?.windSpeedKt).toBe(12);
  expect(store.getManualMsaFt(a.id,b.id)).toBeNull();
  expect(store.getPlannedAltitudeFt(d.id,a.id)).toBe(2500);
  expect(shapes.getShapeDraft()).toEqual(bends.filter(bend=>bend.fromId===b.id));
  expect(store.undoLastAction()).toBe(true);
  expect(store.exportWorkingDraftState()).toEqual(before);
  expect(shapes.getShapeDraft()).toEqual(bends);
  store.redoLastAction();
  expect(store.getWaypoints().map(p=>p.name)).toEqual(['B','C','D','A','E']);
});

it('splits a deliberately blank-level shaped leg without inventing MSA and can undo the insertion', () => {
  const store = new FlightPlanStore(), shapes = new RouteShapeController(store);
  const a=store.addWaypoint({lat:69,lon:18},'A'), b=store.addWaypoint({lat:69.5,lon:19},'B');
  store.setPlannedAltitudeFt(a.id,b.id,null);
  store.setManualLegWind(a.id,b.id,{windFromDeg:220,windSpeedKt:15});
  shapes.setLegShape(0,{lat:69.3,lon:18.3});
  store.setManualMsaFt(a.id,b.id,2000);
  const before = store.exportWorkingDraftState(), bends = shapes.getShapeDraft();
  const inserted = store.insertWaypointAt(1,{lat:69.3,lon:18.3})!;
  expect(store.getWaypoints().map(p=>p.id)).toEqual([a.id,inserted.id,b.id]);
  expect(store.getPlannedAltitudeFt(a.id,inserted.id)).toBeNull();
  expect(store.getPlannedAltitudeFt(inserted.id,b.id)).toBeNull();
  expect(store.getManualLegWind(inserted.id,b.id)?.windSpeedKt).toBe(15);
  expect(store.getManualMsaFt(a.id,b.id)).toBeNull();
  expect(shapes.hasAnyShapes()).toBe(false);
  store.undoLastAction();
  expect(store.exportWorkingDraftState()).toEqual(before);
  expect(shapes.getShapeDraft()).toEqual(bends);
});

it('retains published airport provenance and airport constraints in a single insertion action', () => {
  const store = new FlightPlanStore();
  store.addWaypoint({lat:69,lon:18}); store.addWaypoint({lat:70,lon:20});
  const point = {lat:69.5,lon:19,name:'ENDU',aipId:'ENDU',aipEffectiveDate:'2026-09-03',kind:'airport' as const,aerodromeIcao:'ENDU',elevationFt:254,sourceUrl:'https://example.com/aip'};
  const inserted=store.insertWaypointAt(1,point,undefined,point)!;
  expect(store.isAirportWaypoint(inserted.id)).toBe(true);
  expect(store.getWaypointVerticalConstraint(inserted.id)).toMatchObject({mode:'airport',elevationFt:254});
  store.moveWaypointToIndex(inserted.id,0);
  expect(store.getVerticalProfileSettings()).toMatchObject({departureIcaoCode:'ENDU',departureElevationFt:254});
  store.undoLastAction(); store.undoLastAction();
  expect(store.getWaypoints()).toHaveLength(2);
});

it('keeps an existing bend on the correct split leg when inserting along a shaped line', () => {
  for (const beforeBend of [true,false]) {
    const store=new FlightPlanStore(2500), shapes=new RouteShapeController(store);
    const a=store.addWaypoint({lat:69,lon:18},'A'), b=store.addWaypoint({lat:69.5,lon:19},'B');
    const bend={lat:69.5,lon:18};
    shapes.setLegShape(0,bend);
    const original=shapes.getShapeDraft();
    const position=beforeBend ? {lat:69.25,lon:18} : {lat:69.5,lon:18.5};
    const inserted=shapes.insertWaypointIntoLeg(a.id,b.id,position)!;
    expect(shapes.getShapeDraft()).toEqual([{fromId:beforeBend ? inserted.id : a.id,toId:beforeBend ? b.id : inserted.id,coordinate:bend}]);
    store.undoLastAction();
    expect(store.getWaypoints()).toHaveLength(2);
    expect(shapes.getShapeDraft()).toEqual(original);
  }
});

it('uses one color through reporting points and a new color at each identified airport, including return visits', () => {
  const store = new FlightPlanStore();
  const [dep,wp1,an,wp2,lk,wp3,back]=['ENDU','NORA','ENAN','POINT','ENLK','POINT','ENDU'].map((name,i)=>store.addWaypoint({lat:69+i*.01,lon:18+i*.02},name));
  for (const [point,code] of [[dep,'ENDU'],[an,'ENAN'],[lk,'ENLK'],[back,'ENDU']] as const) identifyTestAirport(store,point.id,code);
  // An ICAO-looking reporting-point name must not create an airport boundary.
  store.updateWaypoint(wp2.id,{name:'ENTC',aipId:'ENAN:point',aipEffectiveDate:'2026-09-03'});
  const sectors=airportRouteSectors(store.getLegs(),point=>store.isAirportWaypoint(point.id));
  expect(sectors.map(s=>s.legs.map(l=>l.from.id))).toEqual([[dep.id,wp1.id],[an.id,wp2.id],[lk.id,wp3.id]]);
  expect(new Set(sectors.map(s=>s.color)).size).toBe(3);
  store.moveWaypointToIndex(an.id,4);
  expect(airportRouteSectors(store.getLegs(),p=>store.isAirportWaypoint(p.id)).map(s=>s.legs.at(-1)!.to.id)).toEqual([lk.id,an.id,back.id]);
});

it('drops before or after another waypoint without swapping unrelated points or modifying input edits', () => {
  const store=new FlightPlanStore();
  const points=['A','B','C','D'].map((name,i)=>store.addWaypoint({lat:69+i*.1,lon:18},name));
  const element=document.createElement('section'); document.body.append(element);
  const panel=new RoutePanel(element,store); store.subscribe(()=>panel.render()); panel.render();
  const drag=(id:string,target:string,y:number)=>{
    const handle=element.querySelector<HTMLElement>(`[data-id="${id}"] [data-drag-waypoint]`)!;
    handle.setPointerCapture=vi.fn(); handle.hasPointerCapture=()=>false;
    handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,clientY:50,button:0}));
    const card=element.querySelector<HTMLElement>(`[data-id="${target}"]`)!;
    card.getBoundingClientRect=()=>({top:0,height:100}) as DOMRect;
    const hit=vi.spyOn(document,'elementFromPoint').mockReturnValue(card);
    handle.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,clientY:y}));
    handle.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,clientY:y}));
    hit.mockRestore();
  };
  drag(points[0].id,points[2].id,90);
  expect(store.getWaypoints().map(p=>p.name)).toEqual(['B','C','A','D']);
  expect(element.querySelector('[role="status"]')?.textContent).toContain('position 3');
  drag(points[3].id,points[1].id,10);
  expect(store.getWaypoints().map(p=>p.name)).toEqual(['D','B','C','A']);
  expect(element.querySelector('input')?.hasAttribute('draggable')).toBe(false);
});
