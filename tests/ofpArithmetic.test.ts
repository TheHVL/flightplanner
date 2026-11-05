// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { OFPTable } from '../src/components/OFPTable';
import { PlanningWorkflow } from '../src/components/PlanningWorkflow';
import { calculateFuelPlanForStore, DEFAULT_FUEL_PLANNING_SETTINGS, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { identifyTestAirport } from './helpers/airports';

beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });
function levelRoute(latitudes: number[]) {
  const store = new FlightPlanStore(3000);
  latitudes.forEach((lat, i) => store.addWaypoint({ lat, lon: 10 }, `WP${i + 1}`));
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.updateNavigationSettings({ tasKt: 120, automaticVariation: false, variationDegEast: 0, windSpeedKt: 0 });
  store.updateVerticalProfileSettings({ departureElevationFt: 3000, destinationElevationFt: 3000 });
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 12 });
  return store;
}
function render(store: FlightPlanStore) {
  const element = document.createElement('section');
  new OFPTable(element, store).render();
  return { element, rows: [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')] };
}

it('adds the visible 4 + 10 + 7 minute INT entries to 4, 14, 21 ACC minutes and the total', () => {
  const store = levelRoute([60, 60.1, 60.4, 60.6]);
  const plan = calculateFuelPlanForStore(store);
  expect(plan.legs.reduce((sum, leg) => sum + leg.flightTimeMin, 0)).toBeCloseTo(18.012, 2);
  const { rows, element } = render(store);
  expect(rows.map(row => row.cells[18].textContent)).toEqual(['0:04', '0:10', '0:07']);
  expect(rows.map(row => row.cells[8].textContent)).toEqual(['0:04', '0:14', '0:21']);
  expect(element.querySelector('[data-ofp-total-time]')!.textContent).toBe('0:21');
  const sidebar = document.createElement('aside');
  sidebar.innerHTML = '<span data-workflow-summary="vertical"></span>';
  new PlanningWorkflow(sidebar, store);
  expect(sidebar.textContent).toContain('21 min planned');
  // The summary must stay usable when the wind makes a track impossible.
  expect(() => store.updateNavigationSettings({ windFromDeg: 90, windSpeedKt: 150 })).not.toThrow();
  expect(sidebar.textContent).toContain('Time needs review');
  store.updateNavigationSettings({ windSpeedKt: 0 });
});

it('adds each displayed pattern duration, including a departure pattern, without changing exact fuel', () => {
  const store = levelRoute([60, 60.1, 60.4]);
  const [a, b] = store.getWaypoints();
  for (const point of [a, b]) {
    identifyTestAirport(store, point.id);
    store.setWaypointVerticalConstraint(point.id, { mode: 'circuits', elevationFt: 3000, circuitCount: 1, minutesPerCircuit: 7.5 });
  }
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 12, circuitFuelFlowGph: 12, totalFuelOnboardGal: 50 });
  const plan = calculateFuelPlanForStore(store);
  const { rows, element } = render(store);
  expect(rows.map(row => row.cells[18].textContent)).toEqual(['0:08', '0:04', '0:08', '0:10']);
  expect(rows.map(row => row.cells[8].textContent)).toEqual(['0:08', '0:12', '0:20', '0:30']);
  expect(element.querySelector('[data-ofp-total-time]')!.textContent).toBe('0:30');
  expect(plan.circuitFuelGal).toBe(3);
  expect(rows.at(-1)!.cells[22].textContent).toBe(plan.landingFuelGal!.toFixed(1));
});

for (const fixture of [
  { lat: 69.17169977392132, lon: 17.20034339266515, track: 301.4, wca: -0.6, mt: '301°', mh: '300°' },
  { lat: 68.75758606335863, lon: 17.365960842919165, track: 223.6, wca: -1.4, mt: '224°', mh: '223°' },
]) it(`derives MH from the visible MT ${fixture.mt} and WCA -1°`, () => {
  const store = levelRoute([]);
  store.addWaypoint({ lat: 69, lon: 18 }, 'A');
  store.addWaypoint(fixture, 'B');
  // Choose a wind producing the specified correction, independently of the OFP rounding.
  const from = fixture.track + Math.asin(120 * Math.sin(fixture.wca * Math.PI / 180) / 10) * 180 / Math.PI;
  store.updateNavigationSettings({ windFromDeg: from, windSpeedKt: 10 });
  expect(store.getLegs()[0].trueTrackDeg).toBeCloseTo(fixture.track, 8);
  expect(calculateFuelPlanForStore(store).legs[0].wcaDeg).toBeCloseTo(fixture.wca, 8);
  const { rows: [row] } = render(store);
  expect(row.cells[4].textContent).toBe(fixture.mt);
  expect(row.cells[6].textContent).toBe('-1°');
  expect(row.cells[15].textContent).toBe(fixture.mh);
});

it('calculates INT and ACC fuel with onboard and contingency blank, retaining them when onboard changes', () => {
  const store = levelRoute([60, 60.1, 60.4]);
  const before = render(store).rows;
  expect(before.map(row => row.cells[10].textContent)).toEqual(['1', '2']);
  expect(before.map(row => row.cells[11].textContent)).toEqual(['1', '3']);
  expect(before.map(row => row.cells[22].textContent)).toEqual(['—', '—']);
  saveFuelPlanningSettings({ ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 12, totalFuelOnboardGal: 50 });
  const after = render(store).rows;
  for (let i = 0; i < before.length; i++) {
    for (const cell of [10, 11]) expect(after[i].cells[cell].textContent).toBe(before[i].cells[cell].textContent);
    expect(after[i].cells[22].textContent).not.toBe('—');
  }
});
