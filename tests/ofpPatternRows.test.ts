// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { RouteShapeController } from '../src/flightplan/RouteShapeController';
import { OFPTable } from '../src/components/OFPTable';
import { VerticalProfilePanel } from '../src/components/VerticalProfilePanel';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { capturePlan, createPlan, parsePlanFile, SavedPlanRepository } from '../src/flightplan/savedPlans';
import { formatPlanningTime, ceilFuelUsageGal } from '../src/presentation/planningRounding';

beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
function trainingRoute() {
  const store = new FlightPlanStore();
  const a = store.addWaypoint({ lat: 60, lon: 10 }, 'A');
  const b = store.addWaypoint({ lat: 60.5, lon: 10 }, 'B');
  const c = store.addWaypoint({ lat: 61, lon: 10 }, 'C');
  store.updateNavigationSettings({ tasKt: 120, windSpeedKt: 0 });
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.setPlannedAltitudeFt(a.id, b.id, 3000);
  store.setPlannedAltitudeFt(b.id, c.id, 3000);
  store.updateVerticalProfileSettings({ departureElevationFt: 3000, destinationElevationFt: 3000 });
  store.setWaypointVerticalConstraint(b.id, { mode: 'circuits', elevationFt: 3000, circuitCount: 2, minutesPerCircuit: 5 });
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 10, circuitFuelFlowGph: 12, totalFuelOnboardGal: 50 });
  return { store, a, b, c };
}
function render(store: FlightPlanStore) {
  const element = document.createElement('section');
  new OFPTable(element, store).render();
  return [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

describe('OFP pattern accounting and layout', () => {
  it('inserts a separate ten-minute pattern row before the airport separator, with aligned time and fuel columns', () => {
    const { store, b } = trainingRoute();
    const plan = calculateFuelPlanForStore(store);
    const [inbound, pattern, outbound] = render(store);
    expect(pattern.dataset.patternWaypoint).toBe(b.id);
    expect(pattern.cells[0].textContent).toBe('BPattern × 2');
    expect(inbound.cells.length).toBe(25);
    expect(pattern.cells.length).toBe(25);
    expect(outbound.cells.length).toBe(25);
    expect(inbound.classList.contains('ofp-touch-and-go-boundary')).toBe(false);
    expect(pattern.classList.contains('ofp-touch-and-go-boundary')).toBe(true);
    expect(pattern.cells[9].textContent).toBe('12.0');
    expect(pattern.cells[10].textContent).toBe('2');
    expect(pattern.cells[11].textContent).toBe(String(ceilFuelUsageGal(plan.legs[0].legFuelGal! + 2)));
    expect(pattern.cells[18].textContent).toBe('0:10');
    expect(pattern.cells[8].textContent).toBe(formatPlanningTime(plan.legs[0].flightTimeMin + 10));
    expect(pattern.cells[22].textContent).toBe((50 - 1.7 - plan.legs[0].legFuelGal! - 2).toFixed(1));
    for (const index of [1,2,3,4,5,6,7,12,13,14,15,16,17,19,20,21,23,24]) {
      expect(pattern.cells[index].textContent).toBe('');
    }
    expect(outbound.cells[18].textContent).toBe(formatPlanningTime(plan.legs[1].flightTimeMin));
    expect(outbound.cells[8].textContent).toBe(formatPlanningTime(plan.legs.reduce((sum, leg) => sum + leg.flightTimeMin, 10)));
    expect(outbound.cells[11].textContent).toBe(String(ceilFuelUsageGal(plan.enrouteFuelGal!)));
    expect(outbound.cells[22].textContent).toBe(plan.landingFuelGal!.toFixed(1));
  });

  it('preserves flight INT fuel and shows unknown accumulated fuel after a pattern with missing FF', () => {
    const { store } = trainingRoute();
    saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 10, totalFuelOnboardGal: 50 });
    const [inbound, pattern, outbound] = render(store);
    expect(inbound.cells[10].textContent).not.toBe('—');
    expect(pattern.cells[18].textContent).toBe('0:10');
    expect(pattern.cells[10].textContent).toBe('—');
    expect(pattern.cells[11].textContent).toBe('—');
    expect(outbound.cells[10].textContent).not.toBe('—');
    expect(outbound.cells[11].textContent).toBe('—');
    expect(outbound.cells[22].textContent).toBe('—');
  });

  it('loads legacy circuit settings and selections without a schema migration and renders final-arrival patterns', () => {
    const { store, a, b, c } = trainingRoute();
    store.setWaypointVerticalConstraint(c.id, { mode: 'circuits', circuitCount: 2, minutesPerCircuit: 5 });
    store.setManualFrequency(a.id, b.id, '126.455');
    const shapes = new RouteShapeController(store);
    const saved = parsePlanFile(JSON.stringify(createPlan('Pattern training', capturePlan(store, shapes))));
    expect(saved.schemaVersion).toBe(1);
    const target = new FlightPlanStore();
    new SavedPlanRepository(localStorage).load(saved, target, new RouteShapeController(target));
    expect(capturePlan(target, new RouteShapeController(target))).toEqual(capturePlan(store, shapes));
    const rows = render(target);
    expect(rows).toHaveLength(4);
    expect(rows[3].dataset.patternWaypoint).toBe(c.id);
    expect(rows[3].cells[18].textContent).toBe('0:10');
    expect(rows[0].cells[24].textContent).toBe('126.455Edit');
    expect(calculateFuelPlanForStore(target).circuitFuelGal).toBe(4);
  });

  it('lets a two-waypoint flight add patterns at the destination from the profile menu', () => {
    const store = new FlightPlanStore();
    store.addWaypoint({ lat: 60, lon: 10 }, 'A');
    const destination = store.addWaypoint({ lat: 61, lon: 10 }, 'B');
    const element = document.createElement('section');
    const panel = new VerticalProfilePanel(element, store); panel.render();
    const select = element.querySelector<HTMLSelectElement>('[aria-label="Arrival pattern"]')!;
    select.value = 'circuits'; select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getWaypointVerticalConstraint(destination.id).mode).toBe('circuits');
    expect(element.textContent).not.toMatch(/Circuit|circuits/);
    const count = element.querySelector<HTMLInputElement>('[data-vertical-circuit-count]')!;
    count.value = '2'; count.dispatchEvent(new Event('change', { bubbles: true }));
    const minutes = element.querySelector<HTMLInputElement>('[data-vertical-circuit-minutes]')!;
    minutes.value = '5'; minutes.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.getWaypointActivityMinutes(destination.id)).toBe(10);
    expect(render(store).at(-1)?.cells[18].textContent).toBe('0:10');
  });
});
