// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { capturePlan, createPlan, parsePlanFile, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { OFPTable } from '../src/components/OFPTable';
beforeEach(()=>{ localStorage.clear(); });
function route() { const store=new FlightPlanStore(), shapes=new RouteShapeController(store); const a=store.addWaypoint({lat:69,lon:18},'ENDU'),b=store.addWaypoint({lat:69.6,lon:19},'ENTC'); return {store,shapes,a,b}; }
describe('manual frequency persistence',()=>{
  it('round trips overrides through saved plans and supports undo and restoring automatic mode',()=>{
    const {store,shapes,a,b}=route();
    expect(store.setManualFrequency(a.id,b.id,'126.455 / 123.755')).toBe(true);
    const plan=parsePlanFile(JSON.stringify(createPlan('Radio flight',capturePlan(store,shapes))));
    expect(JSON.stringify(plan)).not.toContain('segments');
    const target=new FlightPlanStore(), targetShapes=new RouteShapeController(target);
    new SavedPlanRepository(localStorage).load(plan,target,targetShapes);
    expect(target.getManualFrequency(a.id,b.id)).toBe('126.455 / 123.755');
    target.setManualFrequency(a.id,b.id,null);
    expect(target.getManualFrequency(a.id,b.id)).toBeNull();
    target.undoLastAction();expect(target.getManualFrequency(a.id,b.id)).toBe('126.455 / 123.755');
  });
  it('loads older files without overrides and rejects malformed channel entries',()=>{
    const {store,shapes,a,b}=route(); const plan=createPlan('Old plan',capturePlan(store,shapes));
    const old=JSON.parse(JSON.stringify(plan));delete old.flightPlan.manualFrequencies;
    expect(parsePlanFile(JSON.stringify(old)).flightPlan.manualFrequencies).toEqual([]);
    old.flightPlan.manualFrequencies=[[`${a.id}->${b.id}`,'999.123']];expect(()=>parsePlanFile(JSON.stringify(old))).toThrow();
    expect(store.setManualFrequency(a.id,b.id,'126.45')).toBe(false);
    expect(store.getManualFrequency(a.id,b.id)).toBeNull();
  });
  it('removes overrides from split or moved legs and restores them with undo',()=>{
    const {store,shapes,a,b}=route();store.setManualFrequency(a.id,b.id,'126.455');
    store.insertWaypointAt(1,{lat:69.3,lon:18.5});
    expect(store.exportWorkingDraftState().manualFrequencies).toEqual([]);
    expect(()=>createPlan('Split',capturePlan(store,shapes))).not.toThrow();
    store.undoLastAction();expect(store.getManualFrequency(a.id,b.id)).toBe('126.455');
    store.updateWaypoint(a.id,{lat:68.9});expect(store.getManualFrequency(a.id,b.id)).toBeNull();
  });
  it('lets the OFP edit a manual channel and clears it back to automatic',()=>{
    const {store,a,b}=route();const element=document.createElement('section');document.body.append(element);
    const table=new OFPTable(element,store);store.subscribe(()=>table.render());table.render();
    let input=element.querySelector<HTMLInputElement>('[data-freq-from]')!;
    input.value='126.455';input.dispatchEvent(new Event('change',{bubbles:true}));
    expect(store.getManualFrequency(a.id,b.id)).toBe('126.455');
    expect(element.querySelector('.ofp-frequency-cell')?.textContent).toContain('Manual');
    input=element.querySelector<HTMLInputElement>('[data-freq-from]')!;input.value='';input.dispatchEvent(new Event('change',{bubbles:true}));
    expect(store.getManualFrequency(a.id,b.id)).toBeNull();
  });
});
