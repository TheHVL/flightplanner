// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { FlightPlanStore, parseWorkingDraftState } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { capturePlan, createPlan, parsePlanFile, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { calculateFuelPlanForStore, getFuelPlanningSettings, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { applySchoolPreset } from '../src/performance/schoolPreset';
import { approximateTasFromIas } from '../src/performance/airspeed';
import { PerformancePanel } from '../src/components/PerformancePanel';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
function route() {
  const store = new FlightPlanStore();
  const a = store.addWaypoint({lat: 60, lon: 10}, 'A'), b = store.addWaypoint({lat: 61, lon: 10}, 'B');
  store.setPlannedAltitudeFt(a.id, b.id, 3000);
  return store;
}
it('applies school settings explicitly and preserves route, onboard fuel and per-flight contingency', () => {
  const store = route(), points = store.getWaypoints();
  saveFuelPlanningSettings({...getFuelPlanningSettings(), totalFuelOnboardGal: 60, contingencyGal: 3});
  applySchoolPreset(store);
  expect(store.getWaypoints()).toEqual(points);
  expect(store.getPerformanceSettings()).toMatchObject({rpm: 2200, manifoldPressureInHg: 20});
  expect(store.getVerticalProfileSettings()).toMatchObject({climbRateFpm: 500, climbGroundSpeedKt: 90, climbSpeedMode: 'ias', descentRateFpm: 700, descentSpeedMode: 'cruise'});
  expect(getFuelPlanningSettings()).toMatchObject({climbPerformanceMode: 'manual', climbFuelFlowGph: null, descentFuelFlowGph: 10, circuitFuelFlowGph: 12, startupTaxiTakeoffGal: 2, reserveGal: 12, totalFuelOnboardGal: 60, contingencyGal: 3});
});
it('density correction keeps IAS distinct from TAS and rejects invalid conditions', () => {
  expect(approximateTasFromIas(90, 0, 15)).toBeCloseTo(90, 8);
  expect(approximateTasFromIas(90, 5000, 5.094)).toBeCloseTo(96.96, 1);
  expect(approximateTasFromIas(90, 5000, 25)).toBeGreaterThan(approximateTasFromIas(90, 5000, 5));
  expect(() => approximateTasFromIas(90, 2000, NaN)).toThrow();
});
it('uses confirmed rates, density-corrected climb IAS and changing cruise TAS for TOD', () => {
  const store = route(); applySchoolPreset(store);
  let fuel = calculateFuelPlanForStore(store);
  const climb = fuel.verticalProfile!.events.find(e => e.type === 'TOC')!;
  const descent = fuel.verticalProfile!.events.find(e => e.type === 'TOD')!;
  expect(climb.timeMin).toBe(6);
  expect(climb.phaseTasKt).toBeGreaterThan(90);
  expect(descent.timeMin).toBeCloseTo(3000 / 700, 8);
  expect(descent.phaseTasKt).toBeCloseTo(fuel.legs[0].cruiseTasKt, 8);
  store.updatePerformanceSettings({manifoldPressureInHg: 22});
  fuel = calculateFuelPlanForStore(store);
  const faster = fuel.verticalProfile!.events.find(e => e.type === 'TOD')!;
  expect(faster.phaseTasKt).toBeGreaterThan(descent.phaseTasKt);
  expect(faster.routeDistanceNm).toBeLessThan(descent.routeDistanceNm);
});
it('withholds trip fuel until climb FF is confirmed and keeps reserve outside trip fuel', () => {
  const store = route(); applySchoolPreset(store);
  expect(calculateFuelPlanForStore(store).tripFuelGal).toBeNull();
  saveFuelPlanningSettings({...getFuelPlanningSettings(), climbFuelFlowGph: 14});
  const fuel = calculateFuelPlanForStore(store);
  expect(fuel.tripFuelGal).toBeCloseTo(fuel.enrouteFuelGal! + 2, 8);
  expect(fuel.tripPlusReserveGal).toBeCloseTo(fuel.tripFuelGal! + 12, 8);
  expect(fuel.tripReserveContingencyGal).toBeNull();
  saveFuelPlanningSettings({...getFuelPlanningSettings(), contingencyGal: 3, totalFuelOnboardGal: fuel.tripFuelGal! + 11.9});
  const withPolicy = calculateFuelPlanForStore(store);
  expect(withPolicy.tripReserveContingencyGal).toBeCloseTo(fuel.tripFuelGal! + 15, 8);
  expect(withPolicy.warnings.join(' ')).toContain('below the entered 12 US gal reserve');
  expect(withPolicy.warnings[0]).toContain('trip + reserve + contingency subtotal');
});
it('round-trips school speed modes and fuel policy and accepts legacy plans without them', () => {
  const store = route(); applySchoolPreset(store);
  const shapes = new RouteShapeController(store);
  const saved = createPlan('School', capturePlan(store, shapes));
  expect(parsePlanFile(JSON.stringify(saved))).toEqual(saved);
  const restored = new FlightPlanStore();
  new SavedPlanRepository(localStorage).load(saved, restored, new RouteShapeController(restored));
  expect(restored.getVerticalProfileSettings()).toMatchObject({climbSpeedMode: 'ias', descentSpeedMode: 'cruise'});
  const legacy = structuredClone(saved);
  delete legacy.flightPlan.verticalProfileSettings.climbSpeedMode;
  delete legacy.flightPlan.verticalProfileSettings.descentSpeedMode;
  delete legacy.fuelSettings.reserveGal; delete legacy.fuelSettings.contingencyGal;
  expect(parsePlanFile(JSON.stringify(legacy)).flightPlan.verticalProfileSettings.descentSpeedMode).toBeUndefined();
  const invalid = structuredClone(saved); invalid.flightPlan.verticalProfileSettings.descentSpeedMode = 'invalid' as never;
  expect(parseWorkingDraftState(invalid.flightPlan)).toBeNull();
});
it('manual preset button updates the visible fuel panel and retains editable contingency', () => {
  const store = route();
  const settings = document.createElement('div'), fuel = document.createElement('div');
  document.body.append(settings, fuel);
  new PerformancePanel(settings, store, 'settings').render();
  new PerformancePanel(fuel, store, 'fuel').render();
  settings.querySelector<HTMLButtonElement>('[data-school-preset]')!.click();
  expect(fuel.querySelector<HTMLInputElement>('[data-fuel-field="startupTaxiTakeoffGal"]')!.value).toBe('2');
  expect(fuel.querySelector<HTMLInputElement>('[data-fuel-field="descentFuelFlowGph"]')!.value).toBe('10');
  expect(fuel.querySelector<HTMLInputElement>('[data-fuel-field="circuitFuelFlowGph"]')!.value).toBe('12');
  expect(fuel.querySelector<HTMLInputElement>('[data-fuel-field="contingencyGal"]')!.value).toBe('');
});
