import { expect, test, type Page } from '@playwright/test';
import { FlightPlanStore } from '../src/flightplan/FlightPlanStore';
import { DEFAULT_FUEL_PLANNING_SETTINGS } from '../src/fuel/fuelPlanning';
import { overlappingProfileRoute } from '../tests/helpers/overlappingProfile';

async function load(page: Page, store: FlightPlanStore) {
  await page.goto('./');
  await page.evaluate(({ flightPlan, fuel }) => {
    localStorage.setItem('flightplanner-working-route-v1', JSON.stringify({ schemaVersion: 1, savedAtUtc: new Date().toISOString(), flightPlan, routeShapes: [] }));
    localStorage.setItem('flightplanner-fuel-settings-v1', JSON.stringify(fuel));
  }, { flightPlan: store.exportWorkingDraftState(), fuel: { ...DEFAULT_FUEL_PLANNING_SETTINGS, manualCruiseFuelFlowGph: 12, descentFuelFlowGph: 8 } });
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
}
function levelStore() {
  const store = new FlightPlanStore(3000);
  store.updatePerformanceSettings({ usePohPerformance: false });
  store.updateNavigationSettings({ tasKt: 120, automaticVariation: false, variationDegEast: 0, windSpeedKt: 0 });
  store.updateVerticalProfileSettings({ departureElevationFt: 3000, destinationElevationFt: 3000 });
  return store;
}
const cells = async (page: Page, index: number) => page.locator('#ofp-table tbody tr').evaluateAll((rows, cell) => rows.map(row => (row as HTMLTableRowElement).cells[cell].textContent), index);

test('an overlapping profile keeps independent leg fuel visible and marks dependent totals incomplete', async ({ page }) => {
  const { store, fuelSettings } = overlappingProfileRoute();
  await load(page, store);
  await page.evaluate(fuel => localStorage.setItem('flightplanner-fuel-settings-v1', JSON.stringify(fuel)), fuelSettings);
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  expect(await cells(page, 10)).toEqual(['4', '—', '—', '—', '4']);
  expect(await cells(page, 11)).toEqual(['4', '—', '—', '—', '—']);
  expect(await cells(page, 18)).toEqual(['0:16', '—', '—', '—', '0:16']);
  await expect(page.locator('[data-ofp-total-time]')).toHaveText('—');
  await expect(page.locator('[data-ofp-profile-warning]')).toContainText('WP2 → WP3');
  await expect(page.locator('[data-workflow-summary="vertical"]')).toContainText('Time needs review');
  await page.locator('[data-panel-key="conditions"] > summary').click();
  await expect(page.locator('.fuel-metric--total strong')).toHaveText('PROFILE CONFLICT');
  await page.locator('[data-fuel-field="totalFuelOnboardGal"]').fill('60');
  await expect(page.locator('.fuel-metric--total strong')).toHaveText('PROFILE CONFLICT');
  expect(await cells(page, 10)).toEqual(['4', '—', '—', '—', '4']);
});

test('ACC and summary add visible INT times; Prepare legs winds activate, affect MH/GS and survive reload', async ({ page }) => {
  const store = levelStore();
  [60, 60.1, 60.4, 60.6].forEach((lat, i) => store.addWaypoint({ lat, lon: 10 }, `WP${i + 1}`));
  await load(page, store);
  expect(await cells(page, 18)).toEqual(['0:04', '0:10', '0:07']);
  expect(await cells(page, 8)).toEqual(['0:04', '0:14', '0:21']);
  await expect(page.locator('[data-ofp-total-time]')).toHaveText('0:21');
  await expect(page.locator('[data-workflow-summary="vertical"]')).toContainText('21 min planned');
  expect(await cells(page, 10)).toEqual(['1', '2', '2']);
  expect(await cells(page, 11)).toEqual(['1', '3', '5']);
  expect(await cells(page, 22)).toEqual(['—', '—', '—']);
  await page.locator('[data-panel-key="leg-entry"] > summary').click();
  await page.locator('[data-leg-field="direction"]').fill('270');
  await page.locator('[data-leg-field="speed"]').fill('20');
  await page.locator('[data-leg-field="speed"]').press('Tab');
  await expect(page.locator('[data-leg-use-winds]')).toBeChecked();
  expect((await cells(page, 5))[0]).toBe('270°/20');
  expect((await cells(page, 6))[0]).toBe('-10°');
  expect((await cells(page, 15))[0]).toBe('350°');
  expect((await cells(page, 16))[0]).toBe('118');
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  expect((await cells(page, 5))[0]).toBe('270°/20');
  expect((await cells(page, 15))[0]).toBe('350°');
});

test('displayed MH adds displayed MT and WCA in both reported rounding cases', async ({ page }) => {
  const store = levelStore();
  const a = store.addWaypoint({ lat: 69, lon: 18 }, 'A');
  const b = store.addWaypoint({ lat: 69.17169977392132, lon: 17.20034339266515 }, 'B');
  const c = store.addWaypoint({ lat: 69, lon: 18 }, 'C');
  const d = store.addWaypoint({ lat: 68.75758606335863, lon: 17.365960842919165 }, 'D');
  store.setManualLegWind(a.id, b.id, { windFromDeg: 294, windSpeedKt: 10 });
  store.setManualLegWind(c.id, d.id, { windFromDeg: 207, windSpeedKt: 10 });
  await load(page, store);
  const mt = await cells(page, 4), wca = await cells(page, 6), mh = await cells(page, 15);
  expect([mt[0], wca[0], mh[0]]).toEqual(['301°', '-1°', '300°']);
  expect([mt[2], wca[2], mh[2]]).toEqual(['224°', '-1°', '223°']);
});

test('school phase fuel works with onboard blank; linked descent flow and INT/ACC survive reload', async ({ page }) => {
  const store = new FlightPlanStore(3000);
  store.addWaypoint({ lat: 60, lon: 10 }, 'A');
  store.addWaypoint({ lat: 61, lon: 10 }, 'B');
  await load(page, store);
  await page.locator('[data-panel-key="conditions"] > summary').click();
  await page.locator('#performance-panel [data-school-preset]').click();
  await expect(page.locator('[data-fuel-field="climbFuelFlowGph"]')).toHaveValue('12');
  await expect(page.locator('[data-descent-fuel-mode]')).toHaveValue('cruise');
  await expect(page.locator('[data-fuel-field="descentFuelFlowGph"]')).toBeDisabled();
  await expect(page.locator('[data-fuel-field="totalFuelOnboardGal"]')).toHaveValue('');
  const int = await cells(page, 10), acc = await cells(page, 11);
  expect(int[0]).not.toBe('—'); expect(acc[0]).not.toBe('—');
  expect((await cells(page, 22))[0]).toBe('—');
  await page.locator('[data-fuel-field="totalFuelOnboardGal"]').fill('50');
  expect(await cells(page, 10)).toEqual(int); expect(await cells(page, 11)).toEqual(acc);
  expect((await cells(page, 22))[0]).not.toBe('—');
  await page.locator('[data-fuel-field="totalFuelOnboardGal"]').fill('');
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  expect(await cells(page, 10)).toEqual(int); expect(await cells(page, 11)).toEqual(acc);
  await expect(page.locator('[data-descent-fuel-mode]')).toHaveValue('cruise');
  await expect(page.locator('[data-fuel-field="climbFuelFlowGph"]')).toHaveValue('12');
});
