// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { PlanningHistory } from '../src/components/PlanningHistory';
import { WorkingRouteStatus } from '../src/components/WorkingRouteStatus';
import { restoreWorkingRoute, WORKING_ROUTE_STORAGE_KEY } from '../src/flightplan/workingRoutePersistence';
import { approximateTasFromIas } from '../src/performance/airspeed';

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); document.body.replaceChildren(); });

it('defaults newly added legs to 2500 ft without changing a restored explicit or blank altitude', () => {
  const store = new FlightPlanStore(2500);
  const a = store.addWaypoint({lat: 69, lon: 18}, 'A'), b = store.addWaypoint({lat: 69.2, lon: 18.5}, 'B');
  expect(store.getPlannedAltitudeFt(a.id, b.id)).toBe(2500);
  store.setPlannedAltitudeFt(a.id, b.id, 1000);
  const saved = store.exportWorkingDraftState();
  expect(new FlightPlanStore(2500).restoreWorkingDraftState(saved)).toBe(true);
  store.setPlannedAltitudeFt(a.id, b.id, null);
  const restored = new FlightPlanStore(2500); restored.restoreWorkingDraftState(store.exportWorkingDraftState());
  expect(restored.getPlannedAltitudeFt(a.id, b.id)).toBeNull();
  const c = restored.addWaypoint({lat:69.5,lon:19},'C');
  expect(restored.getPlannedAltitudeFt(b.id,c.id)).toBe(2500);
});

it('undoes and redoes geometry and cleared MSA together, including clearing a route', () => {
  const store = new FlightPlanStore(), shapes = new RouteShapeController(store);
  const a = store.addWaypoint({lat:69,lon:18},'A'), b = store.addWaypoint({lat:69.5,lon:19},'B');
  store.setManualMsaFt(a.id,b.id,2000);
  const direct = store.getLegs()[0].trueTrackDeg;
  shapes.setLegShape(0,{lat:69.5,lon:18}); const first = shapes.getShapeDraft();
  shapes.setLegShape(0,{lat:69.7,lon:18}); const second = shapes.getShapeDraft();
  store.undoLastAction(); expect(shapes.getShapeDraft()).toEqual(first);
  store.undoLastAction(); expect(shapes.hasAnyShapes()).toBe(false); expect(store.getManualMsaFt(a.id,b.id)).toBe(2000);
  store.redoLastAction(); store.redoLastAction(); expect(shapes.getShapeDraft()).toEqual(second);
  expect(store.getLegs()[0].trueTrackDeg).toBe(direct);
  store.clear(); store.undoLastAction(); expect(shapes.getShapeDraft()).toEqual(second);
  store.redoLastAction(); expect(store.getWaypoints()).toHaveLength(0); expect(shapes.hasAnyShapes()).toBe(false);
  store.undoLastAction(); store.addWaypoint({lat:70,lon:20},'C'); expect(store.canRedo()).toBe(false);
});

it('leaves Ctrl+Z in text inputs alone and exposes working plan undo and redo buttons', () => {
  const root = document.createElement('div'), input = document.createElement('input'); document.body.append(root,input);
  const store = new FlightPlanStore(); new PlanningHistory(root,store);
  store.addWaypoint({lat:69,lon:18},'A'); input.focus();
  const native = new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}); input.dispatchEvent(native);
  expect(native.defaultPrevented).toBe(false); expect(document.activeElement).toBe(input); expect(store.getWaypoints()).toHaveLength(1);
  root.querySelector<HTMLButtonElement>('[data-plan-undo]')!.click(); expect(store.getWaypoints()).toHaveLength(0);
  root.querySelector<HTMLButtonElement>('[data-plan-redo]')!.click(); expect(store.getWaypoints()).toHaveLength(1);
  const shortcut = new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true,cancelable:true}); root.dispatchEvent(shortcut);
  expect(shortcut.defaultPrevented).toBe(true); expect(store.getWaypoints()).toHaveLength(0);
});

it('retains damaged data, reports recovery and copies the original before allowing autosave', () => {
  localStorage.setItem(WORKING_ROUTE_STORAGE_KEY, '{damaged');
  const store = new FlightPlanStore(), shapes = new RouteShapeController(store), root = document.createElement('div');
  const status = new WorkingRouteStatus(root,store,shapes);
  expect(status.restore()).toBe(false); expect(root.textContent).toContain('damaged'); expect(root.querySelector('[data-download-recovery]')).not.toBeNull();
  expect(localStorage.getItem(WORKING_ROUTE_STORAGE_KEY)).toBe('{damaged');
  store.addWaypoint({lat:69,lon:18},'A'); expect(status.save()).toBe(true);
  const recoveryKey = Object.keys(localStorage).find(key=>key.startsWith('flightplanner-working-route-recovery-'))!;
  expect(localStorage.getItem(recoveryKey)).toBe('{damaged');
  const reloadedRoot = document.createElement('div'), reloaded = new FlightPlanStore();
  const reloadedStatus = new WorkingRouteStatus(reloadedRoot,reloaded,new RouteShapeController(reloaded));
  expect(reloadedStatus.restore()).toBe(true); expect(reloadedRoot.querySelector('[data-download-recovery]')).not.toBeNull();
  vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('quota');});
  expect(status.save()).toBe(false); expect(root.textContent).toContain('Autosave failed');
});

it('pauses autosave if a damaged original cannot be backed up', () => {
  localStorage.setItem(WORKING_ROUTE_STORAGE_KEY,'not JSON');
  const store = new FlightPlanStore(), shapes = new RouteShapeController(store), root = document.createElement('div');
  const problem = vi.fn(); expect(restoreWorkingRoute(store,shapes,problem)).toBe(false); expect(problem).toHaveBeenCalled();
  const status = new WorkingRouteStatus(root,store,shapes); status.restore();
  vi.spyOn(localStorage,'setItem').mockImplementation(()=>{throw new Error('quota');});
  store.addWaypoint({lat:69,lon:18}); expect(status.save()).toBe(false);
  expect(root.textContent).toContain('Autosave paused'); expect(localStorage.getItem(WORKING_ROUTE_STORAGE_KEY)).toBe('not JSON');
});

it('accepts a plausible negative pressure altitude for IAS correction and rejects values outside the supported range', () => {
  expect(approximateTasFromIas(90,-1000,16.9812)).toBeLessThan(90);
  expect(()=>approximateTasFromIas(90,-2001,15)).toThrow();
});
