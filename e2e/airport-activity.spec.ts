import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('airport map placement offers departure patterns, touch-and-go and landing with undo and saved activity', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.addInitScript(() => localStorage.setItem('flightplanner-fuel-settings-v1', JSON.stringify({
    startupTaxiTakeoffGal: 2, manualCruiseFuelFlowGph: null, climbPerformanceMode: 'poh-normal-90',
    climbFuelFlowGph: null, descentFuelFlowGph: 10, circuitFuelFlowGph: 12, totalFuelOnboardGal: null,
  })));
  await page.goto('./');
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await page.locator('.aip-map-point[aria-label="ENDU airport"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ENDU · departure');
  await expect(dialog.getByRole('button', { name: 'Land', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Patterns', exact: true }).click();
  await dialog.getByLabel('Patterns', { exact: true }).fill('2');
  await dialog.getByLabel('Minutes per pattern').fill('5');
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  await dialog.getByRole('button', { name: 'Apply patterns' }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('.aip-map-point[aria-label="ENTC airport"]').click();
  await expect(dialog).toContainText('ENTC · airport activity');
  await dialog.getByRole('button', { name: 'Touch-and-go', exact: true }).click();
  await expect(page.locator('.waypoint-card').last()).toContainText('Touch-and-go');
  await expect(page.locator('[data-pattern-waypoint] td').nth(18)).toHaveText('0:10');
  await expect(page.locator('[data-pattern-waypoint] td').nth(10)).toHaveText('2');
  const airportMarker = page.getByTitle('ENTC', { exact: true });
  await airportMarker.focus(); await airportMarker.press('Enter');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(airportMarker).toBeFocused();
  await airportMarker.click();
  await dialog.getByRole('button', { name: 'Land', exact: true }).click();
  await expect(page.locator('.waypoint-card').last().locator('[data-action="visit"]')).toHaveText('Land');
  await page.locator('[data-plan-undo]').click();
  await expect(page.locator('.waypoint-card').last()).toContainText('Touch-and-go');
  await expect(dialog).toHaveCount(0);
  await page.locator('[data-plan-redo]').click();
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.waypoint-card').last().locator('[data-action="visit"]')).toHaveText('Land');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('flightplanner-working-route-v1')!).flightPlan);
  expect(saved.verticalWaypointConstraints.map((entry: [string, { airportActivity?: string }]) => entry[1].airportActivity)).toContain('land');
});

test('airport-list additions and dragging a waypoint onto an airport offer the prompt on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.goto('./');
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await page.locator('[data-menu-section="aip-browser"] > summary').click();
  await page.locator('[data-aip-search]').fill('ENDU');
  await expect(page.locator('[data-aip-group="ENDU"]')).toHaveAttribute('open', '');
  await page.locator('[data-aip-group="ENDU"] [data-aip-add-ad]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('ENDU · departure');
  await dialog.getByRole('button', { name: 'Depart', exact: true }).click();
  await page.locator('#map').click({ position: { x: 230, y: 180 }, modifiers: ['Alt'] });
  const marker = page.locator('.leaflet-marker-icon[title^="WP"]').first();
  const origin = await marker.boundingBox();
  const target = await page.locator('.aip-map-point[aria-label="ENTC airport"]').boundingBox();
  // Grab the pin at its coordinate anchor, rather than its raised visual centre.
  await page.mouse.move(origin!.x + origin!.width / 2, origin!.y + 30);
  await page.mouse.down();
  await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(dialog).toContainText('ENTC · airport activity');
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Patterns', exact: true }).click();
  await dialog.getByLabel('Patterns', { exact: true }).fill('2');
  await dialog.getByLabel('Minutes per pattern').fill('7.5');
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await dialog.getByRole('button', { name: 'Apply patterns' }).click();
  await expect(page.locator('.waypoint-card')).toHaveCount(2);
  await expect(page.locator('[data-pattern-waypoint] td').nth(18)).toHaveText('0:15');
  await page.reload();
  await page.getByRole('button', { name: 'I understand and want to continue' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-pattern-waypoint] td').nth(18)).toHaveText('0:15');
});
