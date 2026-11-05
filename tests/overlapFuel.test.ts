// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { calculateFuelPlanForStore, saveFuelPlanningSettings } from '../src/fuel/fuelPlanning';
import { OFPTable } from '../src/components/OFPTable';
import { PerformancePanel } from '../src/components/PerformancePanel';
import { overlappingProfileRoute } from './helpers/overlappingProfile';

beforeEach(() => { localStorage.clear(); document.body.replaceChildren(); });

it('explains that trip fuel needs a profile correction, and entering onboard fuel cannot remove it', () => {
  const { store, fuelSettings } = overlappingProfileRoute();
  saveFuelPlanningSettings(fuelSettings);
  const element = document.createElement('section');
  new PerformancePanel(element, store, 'fuel').render();
  expect(element.querySelector('.fuel-metric--total strong')!.textContent).toBe('PROFILE CONFLICT');
  const onboard = element.querySelector<HTMLInputElement>('[data-fuel-field="totalFuelOnboardGal"]')!;
  onboard.value = '60'; onboard.dispatchEvent(new Event('input', { bubbles: true }));
  expect(element.querySelector('.fuel-metric--total strong')!.textContent).toBe('PROFILE CONFLICT');
  store.setWaypointVerticalConstraint(store.getWaypoints()[3].id, { mode: 'none' });
  expect(element.querySelector('.fuel-metric--total strong')!.textContent).toMatch(/^\d+ GAL$/);
});

it('withholds conflicting transition footprints but keeps independent legs on both sides calculable', () => {
  const { store, fuelSettings } = overlappingProfileRoute();
  const plan = calculateFuelPlanForStore(store, fuelSettings);
  expect(plan.verticalProfile!.profilesOverlap).toBe(true);
  // An incoming/outgoing leg is also affected if it contains part of a
  // conflicting transition, even when the overlap itself is on the short leg.
  expect(plan.legs.map(leg => leg.profileConflict)).toEqual([false, true, true, true, false]);
  for (const index of [0, 4]) {
    expect(plan.legs[index].legFuelGal).toBeCloseTo(3.002023, 5);
    expect(plan.legs[index].phaseWarning).toBeNull();
  }
  for (const index of [1, 2, 3]) {
    expect(plan.legs[index].legFuelGal).toBeNull();
    expect(plan.legs[index].cruiseFuelGal).toBeNull();
    expect(plan.legs[index].phaseWarning).toContain('overlap');
  }
  expect(plan.tripFuelGal).toBeNull();
  expect(plan.landingFuelGal).toBeNull();
  // Changing the plan to remove the second landing resolves the conflict;
  // nothing in the calculator silently changes the requested stops or levels.
  store.setWaypointVerticalConstraint(store.getWaypoints()[3].id, { mode: 'none' });
  const resolved = calculateFuelPlanForStore(store, fuelSettings);
  expect(resolved.verticalProfile!.profilesOverlap).toBe(false);
  expect(resolved.legs.every(leg => leg.legFuelGal !== null)).toBe(true);
  expect(resolved.tripFuelGal).toBeGreaterThan(0);
});

it('keeps valid INT rows visible while ACC, remaining fuel and time stay unknown after the first gap', () => {
  const { store, fuelSettings } = overlappingProfileRoute();
  const point = store.getWaypoints()[3];
  store.setWaypointVerticalConstraint(point.id, { mode: 'circuits', circuitCount: 1, minutesPerCircuit: 7.5 });
  saveFuelPlanningSettings(fuelSettings);
  const element = document.createElement('section');
  new OFPTable(element, store).render();
  const rows = [...element.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  expect(rows.map(row => row.cells[10].textContent)).toEqual(['4', '—', '—', '2', '—', '4']);
  expect(rows.map(row => row.cells[11].textContent)).toEqual(['4', '—', '—', '—', '—', '—']);
  expect(rows.map(row => row.cells[18].textContent)).toEqual(['0:16', '—', '—', '0:08', '—', '0:16']);
  expect(rows.map(row => row.cells[8].textContent)).toEqual(['0:16', '—', '—', '—', '—', '—']);
  expect(rows[0].cells[22].textContent).toBe('45.3');
  expect(rows.at(-1)!.cells[22].textContent).toBe('—');
  expect(element.querySelector('[data-ofp-total-time]')!.textContent).toBe('—');
  expect(element.querySelector('[data-ofp-profile-warning]')!.textContent).toContain('WP2 → WP3');
});
